package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"trae-counter/internal/counter"
	"trae-counter/internal/native"
	"trae-counter/internal/store"
	"trae-counter/internal/traedb"
	"trae-counter/internal/version"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx           context.Context
	counter       *counter.Counter
	store         *store.Store
	lastSavedUser string
	switchTarget  string // Set by SwitchUser, tells autoSaveOnStorageChange to trust this user ID
	saveMu        sync.Mutex
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Initialize store
	s, err := store.NewStore(store.DefaultDBPath())
	if err != nil {
		log.Fatalf("Failed to initialize store: %v", err)
	}
	a.store = s

	// Verify last_active_user against actual Trae state on startup.
	// After a failed switch, last_active_user in DB may be wrong (set to the
	// target user even though Trae didn't actually switch). We use the JWT
	// token's user_id (the most reliable identifier) to find the real current user.
	if traedb.IsTraeLoggedIn(traedb.DefaultTraeDataPath) {
		dbUser, _ := s.GetAppState("last_active_user")
		if dbUser != "" {
			// Use JWT token to identify the real current user
			jwtUserID, _ := traedb.GetJWTUserID()
			if jwtUserID != "" && jwtUserID != dbUser {
				log.Printf("[app] startup: last_active_user %s doesn't match JWT user_id %s, correcting", dbUser, jwtUserID)
				s.SetAppState("last_active_user", jwtUserID)
				s.SetAppState("selected_user", jwtUserID)
			} else if jwtUserID == "" {
				// No JWT token — fall back to log detection
				actualUser, logErr := traedb.GetCurrentTraeUserID(traedb.DefaultTraeDataPath)
				if logErr == nil && actualUser != "" && actualUser != dbUser {
					log.Printf("[app] startup: last_active_user %s doesn't match log detection %s, correcting", dbUser, actualUser)
					s.SetAppState("last_active_user", actualUser)
					s.SetAppState("selected_user", actualUser)
				}
			}
		}
	}

	// Initialize counter
	a.counter = counter.NewCounter(s)

	// Set up counter update callback — updates all displays with the same count
	a.counter.SetOnUpdate(func(total int) {
		native.UpdateStatusBarCount(total)
		native.UpdateTouchBarCount(total)
		runtime.EventsEmit(a.ctx, "countUpdated", total)
	})

	// Set up current user changed callback — notifies frontend when the active Trae user changes
	a.counter.SetOnCurrentUserChanged(func(userID string) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "currentUserChanged", userID)
		}
	})

	// Start auto refresh (fsnotify watches file changes in real-time, 30s fallback polling)
	a.counter.StartAutoRefresh(30 * time.Second)

	// Watch storage.json for credential changes (e.g. user logs in/out in Trae)
	go a.watchStorageJSON()

	// Do initial sync history and user profiles from Trae DB
	// SyncHistory performs a full scan + writes ledger + updates last_scan_timestamp,
	// so a separate Refresh() call is not needed.
	go func() {
		a.counter.SyncHistory()
		a.counter.SyncAllUserProfiles()
		// Auto-save current user's credentials so they can be switched back to later
		a.AutoFreezeCurrentUser()
	}()

	// Set up status bar
	native.SetupStatusBar(
		func() { a.counter.AddManual() },
		func() { a.counter.SubtractManual() },
		func() { runtime.WindowShow(a.ctx) },
		func() { a.quit() },
		func() { a.counter.Refresh() },
		func() { a.RestartApp() },
	)

	// Immediately show today's count from database (before SyncHistory completes)
	if total := a.counter.GetTotal(); total > 0 {
		native.UpdateStatusBarCount(total)
		native.UpdateTouchBarCount(total)
	}

	// Set up app menu (Chinese localization)
	native.SetupAppMenu(version.Get())

	// Set up About callback (emits showAbout event to frontend)
	native.SetAboutCallback(func() {
		runtime.EventsEmit(a.ctx, "showAbout")
	})

	// Request notification permission on first launch
	native.RequestNotificationPermission()

	// Set up Touch Bar
	go func() {
		time.Sleep(500 * time.Millisecond)
		if err := native.SetupTouchBar(); err != nil {
			fmt.Printf("Failed to setup Touch Bar: %v\n", err)
		}
		// Push current count immediately after TouchBar setup
		if total := a.counter.GetTotal(); total >= 0 {
			native.UpdateTouchBarCount(total)
		}
		if a.GetControlStripPinned() {
			native.SetControlStripPinned(true)
		}
	}()

	// Apply saved theme
	theme := a.GetTheme()
	a.applyTheme(theme)

	// Restore window size
	a.restoreWindowSize()

	// Restore dock hidden setting (must be after window is shown)
	if a.GetDockHidden() {
		native.SetDockHidden(true)
	}
}

func (a *App) quit() {
	a.saveWindowSize()
	native.TeardownStatusBar()
	runtime.Quit(a.ctx)
}

func (a *App) shutdown(ctx context.Context) {
	a.saveWindowSize()
	if a.counter != nil {
		a.counter.Stop()
	}
	if a.store != nil {
		a.store.Close()
	}
}

// TodayCountResult is the result struct for GetTodayCount.
type TodayCountResult struct {
	Auto   int `json:"auto"`
	Manual int `json:"manual"`
	Total  int `json:"total"`
}

// Wails-bound methods for frontend

func (a *App) GetTodayCount() (*TodayCountResult, error) {
	auto, manual, total, err := a.counter.GetTodayCount()
	if err != nil {
		return nil, err
	}
	return &TodayCountResult{Auto: auto, Manual: manual, Total: total}, nil
}

func (a *App) AddManual() error {
	return a.counter.AddManual()
}

func (a *App) SetManualCount(count int) error {
	return a.counter.SetManualCount(count)
}

func (a *App) Refresh() error {
	return a.counter.Refresh()
}

// GetWeekHistory returns the last 7 days of counts for a specific user.
func (a *App) GetWeekHistory(userID string) ([]store.LedgerDateCount, error) {
	return a.counter.GetWeekHistory(userID)
}

// GetMonthHistory returns the last 30 days of counts for a specific user.
func (a *App) GetMonthHistory(userID string) ([]store.LedgerDateCount, error) {
	return a.counter.GetMonthHistory(userID)
}

// GetYearHistory returns the last 12 months of aggregated counts for a specific user.
func (a *App) GetYearHistory(userID string) ([]store.LedgerMonthCount, error) {
	return a.counter.GetYearHistory(userID)
}

// GetHourlyCounts returns today's hourly counts for a specific user.
func (a *App) GetHourlyCounts(userID string) ([]store.LedgerHourlyCount, error) {
	return a.counter.GetHourlyCounts(userID)
}

// GetHourlyCountsForDate returns hourly counts for a specific date and user.
func (a *App) GetHourlyCountsForDate(userID, date string) ([]store.LedgerHourlyCount, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store not initialized")
	}
	return a.store.GetLedgerHourlyCounts(userID, date)
}

// GetDayCount returns the total count for a specific date and user.
func (a *App) GetDayCount(userID, date string) (int, error) {
	if a.store == nil {
		return 0, fmt.Errorf("store not initialized")
	}
	return a.store.GetLedgerCountByUserDate(userID, date)
}

// GetAllUserTodayCounts returns today's counts for all users.
func (a *App) GetAllUserTodayCounts() ([]counter.UserTodayCount, error) {
	return a.counter.GetAllUserTodayCounts()
}

// AdjustUserManual adjusts the manual count for a specific user by delta.
func (a *App) AdjustUserManual(userID string, delta int) error {
	return a.counter.AdjustUserManual(userID, delta)
}

// ToggleUserTracking toggles the tracking status for a user.
func (a *App) ToggleUserTracking(userID string) error {
	return a.counter.ToggleUserTracking(userID)
}

// DeleteUser removes a user and all their data.
func (a *App) DeleteUser(userID string) error {
	return a.counter.DeleteUser(userID)
}

// SetUserRemark sets the remark for a user.
func (a *App) SetUserRemark(userID, remark string) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	return a.store.SetUserRemark(userID, remark)
}

// GetUserRemark returns the remark for a user.
func (a *App) GetUserRemark(userID string) (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("store not initialized")
	}
	return a.store.GetUserRemark(userID)
}

// GetLastActiveUser returns the last active user ID.
func (a *App) GetLastActiveUser() (string, error) {
	return a.counter.GetLastActiveUser()
}

// SaveSelectedUser saves the selected user ID and updates status bar to show that user's count.
func (a *App) SaveSelectedUser(userID string) error {
	if err := a.counter.SaveSelectedUser(userID); err != nil {
		return err
	}
	// Sync status bar/Touch Bar with the selected user's count
	a.counter.SendSelectedUserCount(userID)
	return nil
}

// GetSelectedUser returns the saved selected user ID.
func (a *App) GetSelectedUser() (string, error) {
	return a.counter.GetSelectedUser()
}

// UserMessageResult represents per-user message counts.
type UserMessageResult struct {
	UserID string         `json:"user_id"`
	Dates  map[string]int `json:"dates"`
}

// GetUserMessages returns message counts per user per date.
func (a *App) GetUserMessages() ([]UserMessageResult, error) {
	all, err := traedb.GetAllUserMessageCounts(traedb.DefaultTraeDataPath)
	if err != nil {
		return nil, err
	}

	userDates := make(map[string]map[string]int)
	for _, uc := range all {
		if userDates[uc.UserID] == nil {
			userDates[uc.UserID] = make(map[string]int)
		}
		userDates[uc.UserID][uc.Date] += uc.Count
	}

	results := make([]UserMessageResult, 0, len(userDates))
	for userID, dates := range userDates {
		results = append(results, UserMessageResult{
			UserID: userID,
			Dates:  dates,
		})
	}
	return results, nil
}

// GetControlStripPinned returns whether the Control Strip item is pinned.
func (a *App) GetControlStripPinned() bool {
	if a.store == nil {
		return false
	}
	val, err := a.store.GetAppState("controlstrip_pinned")
	if err != nil || val == "" {
		return false // default off
	}
	return val == "1"
}

// SetControlStripPinned sets whether the Control Strip item is pinned.
func (a *App) SetControlStripPinned(pinned bool) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	val := "0"
	if pinned {
		val = "1"
	}
	if err := a.store.SetAppState("controlstrip_pinned", val); err != nil {
		return err
	}
	native.SetControlStripPinned(pinned)
	return nil
}

// GetQuotaInfo returns the current quota information from Trae logs.
func (a *App) GetQuotaInfo() (*traedb.QuotaInfo, error) {
	info, err := traedb.GetQuotaInfo(traedb.DefaultTraeDataPath)
	if err != nil {
		return nil, err
	}
	return info, nil
}

// GetWarningThreshold returns the saved warning threshold (default 40).
func (a *App) GetWarningThreshold() int {
	if a.store == nil {
		return 40
	}
	val, err := a.store.GetAppState("warning_threshold")
	if err != nil || val == "" {
		return 40
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 40
	}
	return n
}

// SetWarningThreshold saves the warning threshold.
func (a *App) SetWarningThreshold(threshold int) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	return a.store.SetAppState("warning_threshold", strconv.Itoa(threshold))
}

// GetAlertThreshold returns the saved alert threshold (default 50).
func (a *App) GetAlertThreshold() int {
	if a.store == nil {
		return 50
	}
	val, err := a.store.GetAppState("alert_threshold")
	if err != nil || val == "" {
		return 50
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 50
	}
	return n
}

// SetAlertThreshold saves the alert threshold.
func (a *App) SetAlertThreshold(threshold int) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	return a.store.SetAppState("alert_threshold", strconv.Itoa(threshold))
}

// GetDockHidden returns whether the app icon is hidden from the Dock.
func (a *App) GetDockHidden() bool {
	if a.store == nil {
		return false
	}
	val, err := a.store.GetAppState("dock_hidden")
	if err != nil || val == "" {
		return false // default off — show Dock icon on first launch
	}
	return val == "1"
}

// SetDockHidden sets whether the app icon is hidden from the Dock (LSUIElement).
func (a *App) SetDockHidden(hidden bool) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	val := "0"
	if hidden {
		val = "1"
	}
	if err := a.store.SetAppState("dock_hidden", val); err != nil {
		return err
	}
	native.SetDockHidden(hidden)
	return nil
}

// GetAutoLaunch returns whether the app auto-launches at login.
func (a *App) GetAutoLaunch() bool {
	if a.store == nil {
		return false
	}
	val, err := a.store.GetAppState("auto_launch")
	if err != nil || val == "" {
		return false // default off until explicitly enabled
	}
	return val == "1"
}

// SetAutoLaunch sets whether the app auto-launches at login.
func (a *App) SetAutoLaunch(enabled bool) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	val := "0"
	if enabled {
		val = "1"
	}
	if err := a.store.SetAppState("auto_launch", val); err != nil {
		return err
	}
	native.SetAutoLaunch(enabled)
	return nil
}

// GetNotifyEnabled returns whether notifications are enabled.
func (a *App) GetNotifyEnabled() bool {
	if a.store == nil {
		return true
	}
	val, err := a.store.GetAppState("notify_enabled")
	if err != nil || val == "" {
		return true // default on
	}
	return val == "1"
}

// SetNotifyEnabled sets whether notifications are enabled.
func (a *App) SetNotifyEnabled(enabled bool) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	val := "0"
	if enabled {
		val = "1"
	}
	return a.store.SetAppState("notify_enabled", val)
}

// HasNotifiedExhaustion checks if an exhaustion notification was already sent
// for the given user on the given date.
func (a *App) HasNotifiedExhaustion(userID, date string) bool {
	if a.store == nil {
		return false
	}
	key := fmt.Sprintf("notified_exhausted_%s_%s", userID, date)
	val, err := a.store.GetAppState(key)
	return err == nil && val == "1"
}

// MarkNotifiedExhaustion records that an exhaustion notification was sent
// for the given user on the given date.
func (a *App) MarkNotifiedExhaustion(userID, date string) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	key := fmt.Sprintf("notified_exhausted_%s_%s", userID, date)
	return a.store.SetAppState(key, "1")
}

// HasNotifiedAlert checks if an alert notification was already sent
// for the given user on the given date.
func (a *App) HasNotifiedAlert(userID, date string) bool {
	if a.store == nil {
		return false
	}
	key := fmt.Sprintf("notified_alert_%s_%s", userID, date)
	val, err := a.store.GetAppState(key)
	return err == nil && val == "1"
}

// MarkNotifiedAlert records that an alert notification was sent
// for the given user on the given date.
func (a *App) MarkNotifiedAlert(userID, date string) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	key := fmt.Sprintf("notified_alert_%s_%s", userID, date)
	return a.store.SetAppState(key, "1")
}

// HasNotifiedWarning checks if a warning notification was already sent
// for the given user on the given date.
func (a *App) HasNotifiedWarning(userID, date string) bool {
	if a.store == nil {
		return false
	}
	key := fmt.Sprintf("notified_warning_%s_%s", userID, date)
	val, err := a.store.GetAppState(key)
	return err == nil && val == "1"
}

// MarkNotifiedWarning records that a warning notification was sent
// for the given user on the given date.
func (a *App) MarkNotifiedWarning(userID, date string) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	key := fmt.Sprintf("notified_warning_%s_%s", userID, date)
	return a.store.SetAppState(key, "1")
}

// saveWindowSize saves the current window dimensions to the store.
func (a *App) saveWindowSize() {
	if a.ctx == nil || a.store == nil {
		return
	}
	w, h := runtime.WindowGetSize(a.ctx)
	a.store.SetAppState("window_width", strconv.Itoa(w))
	a.store.SetAppState("window_height", strconv.Itoa(h))
}

// restoreWindowSize restores the window dimensions from the store.
func (a *App) restoreWindowSize() {
	if a.ctx == nil || a.store == nil {
		return
	}
	wStr, err1 := a.store.GetAppState("window_width")
	hStr, err2 := a.store.GetAppState("window_height")
	if err1 != nil || err2 != nil || wStr == "" || hStr == "" {
		return
	}
	w, err1 := strconv.Atoi(wStr)
	h, err2 := strconv.Atoi(hStr)
	if err1 != nil || err2 != nil || w < 320 || h < 240 {
		return
	}
	runtime.WindowSetSize(a.ctx, w, h)
}

// GetVersion returns the application version string.
func (a *App) GetVersion() string {
	return version.Get()
}

// SendNotification sends a macOS native notification.
func (a *App) SendNotification(title, body string) {
	native.SendNotification(title, body)
}

// SendNotificationWithType sends a typed notification for grouping and behavior control.
// nType: "remind" (auto-dismiss 10s) or "alert" (persistent, timeSensitive)
func (a *App) SendNotificationWithType(title, body, nType string) {
	native.SendNotificationWithType(title, body, nType)
}

// watchStorageJSON watches the Trae storage.json file for changes.
// When it changes (e.g. user logs in/out in Trae), we auto-save the new user's credentials.
func (a *App) watchStorageJSON() {
	globalStoragePath := filepath.Join(traedb.DefaultTraeDataPath, "User", "globalStorage")
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("[app/storage-watcher] fsnotify unavailable: %v", err)
		return
	}
	defer watcher.Close()

	if err := watcher.Add(globalStoragePath); err != nil {
		log.Printf("[app/storage-watcher] cannot watch %s: %v", globalStoragePath, err)
		return
	}
	log.Printf("[app/storage-watcher] watching %s for credential changes", globalStoragePath)

	debounce := time.NewTimer(0)
	if !debounce.Stop() {
		<-debounce.C
	}
	debouncePending := false

	for {
		select {
		case <-a.ctx.Done():
			return
		case event := <-watcher.Events:
			if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
				if strings.Contains(event.Name, "storage.json") {
					if !debouncePending {
						debouncePending = true
						debounce.Reset(5 * time.Second)
					}
				}
			}
		case <-debounce.C:
			debouncePending = false
			a.autoSaveOnStorageChange()
		case err := <-watcher.Errors:
			log.Printf("[app/storage-watcher] error: %v", err)
		}
	}
}

// autoSaveOnStorageChange is called when storage.json changes.
// It detects the current user and saves their credentials.
// We always compare and update if the credential data changed (e.g. token refresh).
func (a *App) autoSaveOnStorageChange() {
	a.saveMu.Lock()
	defer a.saveMu.Unlock()

	// Check if Trae is logged in — if not, notify frontend that no user is active
	if !traedb.IsTraeLoggedIn(traedb.DefaultTraeDataPath) {
		a.lastSavedUser = ""
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "currentUserChanged", "")
		}
		return
	}

	// Read current credentials from storage.json
	credentials, err := traedb.ReadAuthCredentials(traedb.DefaultTraeDataPath)
	if err != nil {
		return
	}
	jsonData, err := json.Marshal(credentials)
	if err != nil {
		return
	}
	newData := string(jsonData)

	// Determine current user
	currentUserID, _ := a.store.GetAppState("last_active_user")

	// If switchTarget is set, we're in the middle of a switch.
	// Verify that the switch actually took effect by checking if storage.json
	// still contains the target user's credentials. If Trae overwrote them
	// with the old user's credentials, the switch failed.
	if a.switchTarget != "" {
		targetUserID := a.switchTarget
		a.switchTarget = "" // Clear immediately to prevent re-entry

		// Check if storage.json still has the target user's credentials
		targetCredJSON, _ := a.store.LoadUserCredential(targetUserID, "storage_auth")
		switchSucceeded := false
		if targetCredJSON != "" && newData == targetCredJSON {
			// storage.json still matches the target user's credentials — switch likely succeeded
			switchSucceeded = true
		}

		if switchSucceeded {
			log.Printf("[app/storage-watcher] switch to %s confirmed — storage.json credentials match", targetUserID)
			currentUserID = targetUserID
			a.store.SetAppState("last_active_user", targetUserID)
		} else {
			// Switch may have failed — Trae overwrote storage.json with old credentials.
			// Use JWT token to determine the actual current user.
			log.Printf("[app/storage-watcher] switch to %s may have failed — storage.json credentials don't match target, checking JWT", targetUserID)
			jwtUID, _ := traedb.GetJWTUserID()
			if jwtUID != "" {
				currentUserID = jwtUID
				log.Printf("[app/storage-watcher] JWT found actual user: %s", jwtUID)
			} else {
				// No JWT yet (Trae still starting) — keep the target user ID
				// from SwitchUser. Don't fall back to log detection because
				// it returns the old user. The post-open monitor will verify.
				currentUserID = targetUserID
				log.Printf("[app/storage-watcher] no JWT yet, keeping target user %s (will verify later)", targetUserID)
			}
			// Update last_active_user with the actual user
			a.store.SetAppState("last_active_user", currentUserID)
		}

		a.lastSavedUser = currentUserID

		// Notify frontend of the current user change
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "currentUserChanged", currentUserID)
		}
		return // Skip saving — don't corrupt credentials during switch verification
	} else if currentUserID != "" {
		// Verify that the current Trae session still belongs to last_active_user
		// by checking the JWT token's user_id (the most reliable identifier).
		// NOTE: iCubeAuthInfo://icube.cloudide values change with every token
		// refresh and CANNOT be used for user identification.
		jwtUserID, _ := traedb.GetJWTUserID()

		if jwtUserID != "" && jwtUserID != currentUserID {
			// JWT says a different user is active — update last_active_user
			log.Printf("[app/storage-watcher] JWT user_id %s differs from last_active_user %s — updating", jwtUserID, currentUserID)
			currentUserID = jwtUserID
			a.store.SetAppState("last_active_user", jwtUserID)
		}
		// NOTE: When JWT is empty (Trae starting up after switch), we do NOT
		// fall back to log detection to update last_active_user. Log detection
		// returns the most recent user from Trae's conversation logs, which is
		// the OLD user after a switch. Using it would overwrite the correct
		// new user ID that was set by SwitchUser. The JWT-based verification
		// in the post-open monitor will correct last_active_user once Trae
		// fully starts and the JWT token becomes available.
	}

	// If still no user, try log detection
	if currentUserID == "" {
		uid, err := traedb.GetCurrentTraeUserID(traedb.DefaultTraeDataPath)
		if err == nil && uid != "" {
			currentUserID = uid
		}
	}

	if currentUserID == "" {
		return
	}

	// Save credentials for the current user
	existingData, _ := a.store.LoadUserCredential(currentUserID, "storage_auth")

	if existingData != newData {
		if err := a.store.SaveUserCredential(currentUserID, "storage_auth", newData); err != nil {
			log.Printf("[app/storage-watcher] failed to save credentials for user %s: %v", currentUserID, err)
			return
		}

		if existingData == "" {
			log.Printf("[app/storage-watcher] saved NEW credentials for user %s (detected storage.json change)", currentUserID)
		} else {
			log.Printf("[app/storage-watcher] updated credentials for user %s (data changed)", currentUserID)
		}
	}

	a.lastSavedUser = currentUserID

	// Always notify frontend of the current user (even if data unchanged)
	// This is important after a switch when frontend has cleared currentTraeUserId
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "currentUserChanged", currentUserID)
	}
}

// findUserByCloudIDEKey searches all saved credentials for a user whose
// iCubeAuthInfo://icube.cloudide value matches the given key.
// This identifies the actual current user by comparing the user-specific
// credential key (which doesn't change with token refreshes).
func (a *App) findUserByCloudIDEKey(s *store.Store, cloudIDEKey string) string {
	// Get all user IDs from the ledger (users who have activity)
	userIDs, err := s.GetAllLedgerUserIDs()
	if err != nil || len(userIDs) == 0 {
		return ""
	}

	for _, userID := range userIDs {
		savedData, err := s.LoadUserCredential(userID, "storage_auth")
		if err != nil || savedData == "" {
			continue
		}
		var savedCreds map[string]json.RawMessage
		if json.Unmarshal([]byte(savedData), &savedCreds) != nil {
			continue
		}
		if v, ok := savedCreds["iCubeAuthInfo://icube.cloudide"]; ok {
			if string(v) == cloudIDEKey {
				return userID
			}
		}
	}
	return ""
}

// AutoFreezeCurrentUser saves the current Trae user's credentials to the store
// so they can be switched back to later. Called on startup.
func (a *App) AutoFreezeCurrentUser() {
	// Use JWT token for reliable user identification (log detection can be stale)
	jwtUID, _ := traedb.GetJWTUserID()
	currentUserID := jwtUID
	if currentUserID == "" {
		// Fall back to log detection if no JWT
		var err error
		currentUserID, err = traedb.GetCurrentTraeUserID(traedb.DefaultTraeDataPath)
		if err != nil {
			log.Printf("[app] auto-freeze: failed to get current user ID: %v", err)
			return
		}
	}
	if currentUserID == "" {
		log.Printf("[app] auto-freeze: no current user found")
		return
	}
	if err := traedb.FreezeCurrentUser(traedb.DefaultTraeDataPath, currentUserID, a.store); err != nil {
		log.Printf("[app] auto-freeze: failed to freeze user %s: %v", currentUserID, err)
		return
	}
	log.Printf("[app] auto-freeze: saved credentials for user %s", currentUserID)

	// Also try to freeze credentials for all users found in logs who have logged in
	// on this machine but may not have been frozen yet
	go a.autoFreezeAllKnownUsers()
}

// SnapshotForUser manually saves the current Trae credentials to a specific user.
// The user must confirm that they are currently logged into Trae as this user.
// This uses the JWT token to verify the actual current user.
func (a *App) SnapshotForUser(userID string) error {
	// Verify Trae is running and we can identify the current user
	jwtUID, _ := traedb.GetJWTUserID()
	if jwtUID == "" {
		return fmt.Errorf("无法识别当前 Trae 用户（JWT token 不存在），请确保 Trae 已启动并登录")
	}
	if jwtUID != userID {
		return fmt.Errorf("当前 Trae 登录的是用户 %s，不是 %s，请先在 Trae 中切换到目标账号", jwtUID, userID)
	}

	// Save credentials
	if err := traedb.FreezeCurrentUser(traedb.DefaultTraeDataPath, userID, a.store); err != nil {
		return fmt.Errorf("保存凭证失败: %w", err)
	}

	log.Printf("[app] snapshot: manually saved credentials for user %s (JWT verified)", userID)
	return nil
}

// DeleteSnapshot removes the saved credential snapshot for a user.
// This is useful when the snapshot is corrupted or was saved for the wrong user.
func (a *App) DeleteSnapshot(userID string) error {
	ok, _ := a.store.HasUserCredential(userID, "storage_auth")
	if !ok {
		return fmt.Errorf("用户 %s 没有保存的快照", userID)
	}
	a.store.DeleteUserCredential(userID, "storage_auth")
	log.Printf("[app] snapshot: deleted credential snapshot for user %s", userID)
	return nil
}

// HasSnapshot checks if a user has a saved credential snapshot.
func (a *App) HasSnapshot(userID string) bool {
	ok, _ := a.store.HasUserCredential(userID, "storage_auth")
	return ok
}

// autoFreezeAllKnownUsers scans log files for users who have logged in
// on this machine. If the current Trae user is one of them and doesn't
// have credentials saved yet, it saves them. This handles the case where
// a user logged in before the app was started.
func (a *App) autoFreezeAllKnownUsers() {
	currentUserID, err := traedb.GetCurrentTraeUserID(traedb.DefaultTraeDataPath)
	if err != nil || currentUserID == "" {
		return
	}

	// Check if current user already has credentials
	ok, _ := a.store.HasUserCredential(currentUserID, "storage_auth")
	if ok {
		return // Already saved
	}

	// Current user doesn't have credentials - save them now
	if err := traedb.FreezeCurrentUser(traedb.DefaultTraeDataPath, currentUserID, a.store); err != nil {
		log.Printf("[app] auto-freeze-all: failed to save credentials for user %s: %v", currentUserID, err)
		return
	}
	log.Printf("[app] auto-freeze-all: saved credentials for user %s (found in logs but not yet saved)", currentUserID)
}

// SwitchUser switches the active Trae user by saving the current user's
// credentials and then restoring the target user's credentials.
//
// CRITICAL: We must quit Trae BEFORE writing credentials to storage.json.
// If we write while Trae is running, Trae will overwrite storage.json during
// its shutdown process, reverting our changes. The correct order is:
// 1. Save current user's credentials (FreezeCurrentUser)
// 2. Quit Trae and wait for it to fully exit
// 3. Write target user's credentials (ThawUser)
// 4. Delete JWT token
// 5. Restart Trae
func (a *App) SwitchUser(userID string) error {
	// Set our window to always-on-top during the switch process,
	// so it doesn't get hidden behind the reopening Trae window.
	if a.ctx != nil {
		runtime.WindowSetAlwaysOnTop(a.ctx, true)
	}

	// 1. Determine current user — use last_active_user from DB (not logs)
	var currentUserID string
	if traedb.IsTraeLoggedIn(traedb.DefaultTraeDataPath) {
		dbUser, _ := a.store.GetAppState("last_active_user")
		if dbUser != "" {
			currentUserID = dbUser
		} else {
			uid, _ := traedb.GetCurrentTraeUserID(traedb.DefaultTraeDataPath)
			currentUserID = uid
		}
		if currentUserID == userID {
			return fmt.Errorf("已经是当前正在使用的账号")
		}
	}

	// 2. Save current user's credentials first (while Trae is still running,
	// so storage.json has the latest data).
	// IMPORTANT: Verify with JWT that the current user actually matches before saving,
	// to prevent saving wrong user's credentials to the wrong name.
	if currentUserID != "" {
		// Verify that the current Trae session actually belongs to currentUserID
		jwtUID, _ := traedb.GetJWTUserID()
		if jwtUID != "" && jwtUID != currentUserID {
			// JWT says a different user is active — don't save under wrong name!
			log.Printf("[app] SwitchUser: JWT user_id %s differs from last_active_user %s — correcting before freeze", jwtUID, currentUserID)
			currentUserID = jwtUID
			// Update last_active_user to the correct user
			a.store.SetAppState("last_active_user", jwtUID)
		}

		if err := traedb.FreezeCurrentUser(traedb.DefaultTraeDataPath, currentUserID, a.store); err != nil {
			return fmt.Errorf("save current user credentials: %w", err)
		}
	}

	// 3. Check if target user has saved credentials
	ok, _ := a.store.HasUserCredential(userID, "storage_auth")

	if !ok {
		// Target user has NO saved credentials — clear auth info and let user log in manually
		// Must quit Trae first to prevent it from overwriting our changes
		if err := a.quitTrae(); err != nil {
			// Continue anyway — Trae might not be running
		}

		if err := traedb.ClearAuthCredentials(traedb.DefaultTraeDataPath); err != nil {
			return fmt.Errorf("clear auth credentials: %w", err)
		}

		if err := traedb.DeleteJWTToken(); err != nil {
			log.Printf("[app] warning: failed to delete JWT token: %v", err)
		}

		a.switchTarget = userID
		a.store.SetAppState("last_active_user", userID)
		a.store.SetAppState("selected_user", userID)
		traedb.InvalidateSessionUserMapCache()
		a.counter.SendSelectedUserCount(userID)
		a.lastSavedUser = ""
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "currentUserChanged", "")
		}

		// Reopen Trae — it will show the login screen
		go func() {
			time.Sleep(2 * time.Second)
			if err := a.openTrae(); err != nil {
				log.Printf("[app] failed to reopen Trae after clearing credentials: %v", err)
			}
			// Wait a bit for Trae to start, then remove always-on-top
			// and bring our window to front (without forcing on-top)
			time.Sleep(5 * time.Second)
			if a.ctx != nil {
				runtime.WindowSetAlwaysOnTop(a.ctx, false)
				runtime.WindowShow(a.ctx)
			}
		}()
		return nil
	}

	// 4. Target user HAS saved credentials — quit Trae FIRST, then restore credentials
	// This is critical: if we write credentials while Trae is running, Trae will
	// overwrite storage.json during its shutdown process.
	if err := a.quitTrae(); err != nil {
		// Continue anyway — Trae might not be running
	}

	// 5. Now safe to write target user's credentials (Trae is not running)
	if err := traedb.ThawUser(traedb.DefaultTraeDataPath, userID, a.store); err != nil {
		return fmt.Errorf("restore target user credentials: %w", err)
	}

	// 6. Delete JWT token — Trae caches the old user's identity in
	// ~/.trae-cn/trae-jwt-token. Removing it forces Trae to re-authenticate
	// with the new credentials from storage.json on startup.
	if err := traedb.DeleteJWTToken(); err != nil {
		log.Printf("[app] warning: failed to delete JWT token: %v", err)
	}

	// 7. Set switchTarget AFTER writing credentials, so autoSaveOnStorageChange
	// can verify the switch correctly when it fires (5s debounce after our write)
	a.switchTarget = userID

	// 8. Update DB and notify frontend
	a.store.SetAppState("last_active_user", userID)
	a.store.SetAppState("selected_user", userID)
	traedb.InvalidateSessionUserMapCache()
	a.counter.SendSelectedUserCount(userID)
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "currentUserChanged", userID)
	}

	// 9. Reopen Trae with the new credentials
	go func() {
		time.Sleep(2 * time.Second)
		if err := a.openTrae(); err != nil {
			log.Printf("[app] failed to reopen Trae after switch: %v", err)
		}
		// Monitor JWT state after Trae starts to verify switch success
		for i := 1; i <= 6; i++ {
			time.Sleep(time.Duration(i*3) * time.Second)
			jwtUID, _ := traedb.GetJWTUserID()

			// If JWT is available and doesn't match target user, switch failed
			if jwtUID != "" && jwtUID != userID {
				log.Printf("[app] SwitchUser: verification failed — JWT user_id %s != target %s, correcting", jwtUID, userID)
				// Correct last_active_user to the actual user
				a.store.SetAppState("last_active_user", jwtUID)
				a.store.SetAppState("selected_user", jwtUID)
				a.counter.SendSelectedUserCount(jwtUID)
				if a.ctx != nil {
					runtime.EventsEmit(a.ctx, "currentUserChanged", jwtUID)
				}
				// Delete the invalid credential snapshot for the target user
				// so next switch will force re-login instead of using bad credentials
				a.store.DeleteUserCredential(userID, "storage_auth")
				log.Printf("[app] SwitchUser: deleted invalid credential snapshot for %s (will require re-login next time)", userID)
				break
			}

			// If JWT matches target user, switch succeeded
			if jwtUID == userID {
				log.Printf("[app] SwitchUser: verified — JWT user_id matches target %s", userID)
				break
			}
		}

		// Remove always-on-top after Trae has started and verification is done
		// Then bring our window to front (without forcing on-top) so it stays visible
		if a.ctx != nil {
			runtime.WindowSetAlwaysOnTop(a.ctx, false)
			runtime.WindowShow(a.ctx)
		}
	}()

	return nil
}

// HasUserCredential checks if a user has credentials available for switching.
// A user can only be switched to if we have a saved snapshot of their credentials
// (captured when they were the active user while our app was running).
func (a *App) HasUserCredential(userID string) bool {
	// Check saved credentials in database
	if a.store != nil {
		ok, err := a.store.HasUserCredential(userID, "storage_auth")
		if err == nil && ok {
			return true
		}
	}

	// Current user is always available (their credentials are in storage.json right now)
	currentID, err := traedb.GetCurrentTraeUserID(traedb.DefaultTraeDataPath)
	if err == nil && currentID == userID {
		return true
	}

	return false
}

// IsTraeLoggedIn checks if Trae IDE currently has a user logged in.
func (a *App) IsTraeLoggedIn() bool {
	return traedb.IsTraeLoggedIn(traedb.DefaultTraeDataPath)
}

// GetCurrentTraeUserID returns the current Trae login user ID.
// Returns empty string if Trae is not logged in.
// Uses last_active_user from DB (source of truth after switch),
// falls back to log detection if DB has no value.
func (a *App) GetCurrentTraeUserID() string {
	if !traedb.IsTraeLoggedIn(traedb.DefaultTraeDataPath) {
		return ""
	}
	// Prefer DB's last_active_user — it's updated immediately on switch
	if a.store != nil {
		dbUser, _ := a.store.GetAppState("last_active_user")
		if dbUser != "" {
			return dbUser
		}
	}
	// Fallback to log detection
	id, err := traedb.GetCurrentTraeUserID(traedb.DefaultTraeDataPath)
	if err != nil {
		return ""
	}
	return id
}

// applyTheme applies the given theme to the Wails window.
func (a *App) applyTheme(theme string) {
	switch theme {
	case "dark":
		runtime.WindowSetDarkTheme(a.ctx)
	case "light":
		runtime.WindowSetLightTheme(a.ctx)
	default:
		runtime.WindowSetSystemDefaultTheme(a.ctx)
	}
}

// GetTheme returns the saved theme preference ("system", "light", or "dark").
func (a *App) GetTheme() string {
	if a.store == nil {
		return "system"
	}
	val, err := a.store.GetAppState("theme")
	if err != nil || val == "" {
		return "system"
	}
	return val
}

// SetTheme saves the theme preference and applies it immediately.
func (a *App) SetTheme(theme string) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	if err := a.store.SetAppState("theme", theme); err != nil {
		return err
	}
	a.applyTheme(theme)
	return nil
}

// RestartApp restarts the application.
func (a *App) RestartApp() {
	appPath, err := os.Executable()
	if err != nil {
		log.Println("Failed to get executable path:", err)
		return
	}
	// In dev mode (wails3 dev), the executable is the wails3 tool, not the app binary.
	// Restarting would fail, so just reload the frontend instead.
	baseName := filepath.Base(appPath)
	if baseName == "wails3" || baseName == "wails3.exe" {
		runtime.WindowReload(a.ctx)
		return
	}
	cmd := exec.Command(appPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Println("Failed to restart app:", err)
		return
	}
	os.Exit(0)
}

// findTraeApp searches for the Trae IDE application in /Applications.
func findTraeApp() (string, error) {
	traePaths := []string{
		"/Applications/Trae CN.app",
		"/Applications/Trae.app",
		"/Applications/TraeCN.app",
	}
	for _, p := range traePaths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("Trae IDE not found in /Applications")
}

// quitTrae quits the Trae IDE application and waits for it to fully exit.
func (a *App) quitTrae() error {
	traePath, err := findTraeApp()
	if err != nil {
		return err
	}
	appName := filepath.Base(traePath)
	quitCmd := exec.Command("osascript", "-e", fmt.Sprintf(`tell application "%s" to quit`, appName))
	_ = quitCmd.Run()

	// Wait for Trae to actually exit (up to 10 seconds)
	for i := 0; i < 20; i++ {
		time.Sleep(500 * time.Millisecond)
		checkCmd := exec.Command("pgrep", "-x", strings.TrimSuffix(appName, ".app"))
		output, err := checkCmd.Output()
		if err != nil || len(output) == 0 {
			// Process no longer running
			log.Printf("[app] Trae confirmed exited after %dms", (i+1)*500)
			return nil
		}
	}
	log.Printf("[app] warning: Trae may still be running after 10s wait")
	return nil
}

// openTrae opens the Trae IDE application.
// It retries up to 3 times with increasing delays, in case Trae is still shutting down.
func (a *App) openTrae() error {
	traePath, err := findTraeApp()
	if err != nil {
		return err
	}

	// Retry opening Trae — it may still be shutting down from the quit command
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		cmd := exec.Command("open", "-a", traePath)
		if err := cmd.Run(); err != nil {
			lastErr = err
			log.Printf("[app] openTrae attempt %d failed: %v", attempt+1, err)
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
			continue
		}
		// Verify Trae actually started by checking for its process
		time.Sleep(1 * time.Second)
		appName := filepath.Base(traePath)
		checkCmd := exec.Command("pgrep", "-x", strings.TrimSuffix(appName, ".app"))
		if output, err := checkCmd.Output(); err == nil && len(output) > 0 {
			log.Printf("[app] Trae confirmed running after attempt %d", attempt+1)
			return nil
		}
		// Process not found yet, wait and retry
		lastErr = fmt.Errorf("Trae process not detected after open command")
		time.Sleep(2 * time.Second)
	}
	if lastErr != nil {
		return fmt.Errorf("failed to open Trae after 3 attempts: %w", lastErr)
	}
	return nil
}

// RestartTrae restarts the Trae IDE application.
// It first quits Trae, then reopens it after a short delay.
func (a *App) RestartTrae() error {
	traePath, err := findTraeApp()
	if err != nil {
		return err
	}

	// First, quit Trae using osascript
	quitCmd := exec.Command("osascript", "-e", fmt.Sprintf(`tell application "%s" to quit`, filepath.Base(traePath)))
	_ = quitCmd.Run()

	// Wait for Trae to fully quit
	time.Sleep(2 * time.Second)

	// Then reopen Trae
	cmd := exec.Command("open", "-a", traePath)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to reopen Trae: %w", err)
	}
	return nil
}

// GetLearnedQuota returns the learned quota for the given user.
// If userID is empty, uses the last active user.
// Returns 0 if no data has been learned yet.
func (a *App) GetLearnedQuota(userID string) int {
	if a.store == nil {
		return 0
	}
	if userID == "" {
		if a.counter == nil {
			return 0
		}
		var err error
		userID, err = a.counter.GetLastActiveUser()
		if err != nil || userID == "" {
			return 0
		}
	}
	learned, err := a.store.GetLearnedQuota(userID)
	if err != nil {
		return 0
	}
	return learned
}

// GetLearnedQuotaForDate returns the learned quota for a user on a specific date.
// Returns 0 if no data found for that date.
func (a *App) GetLearnedQuotaForDate(userID, date string) int {
	if a.store == nil {
		return 0
	}
	if userID == "" {
		return 0
	}
	learned, err := a.store.GetLearnedQuotaForDate(userID, date)
	if err != nil {
		return 0
	}
	return learned
}

// GetAutoThreshold returns whether auto-threshold adjustment is enabled.
func (a *App) GetAutoThreshold() bool {
	if a.store == nil {
		return false
	}
	val, err := a.store.GetAppState("auto_threshold")
	if err != nil || val == "" {
		return false
	}
	return val == "true"
}

// SetAutoThreshold enables or disables auto-threshold adjustment.
func (a *App) SetAutoThreshold(enabled bool) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	val := "false"
	if enabled {
		val = "true"
	}
	return a.store.SetAppState("auto_threshold", val)
}

// GetManualQuota returns the manually set quota limit (default 58).
func (a *App) GetManualQuota() int {
	if a.store == nil {
		return 58
	}
	val, err := a.store.GetAppState("manual_quota")
	if err != nil || val == "" {
		return 58
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 58
	}
	return n
}

// SetManualQuota saves the manually set quota limit.
func (a *App) SetManualQuota(quota int) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	if quota < 1 {
		quota = 1
	}
	return a.store.SetAppState("manual_quota", strconv.Itoa(quota))
}

// GetShowAllAccounts returns whether to show accounts with no data for today.
func (a *App) GetShowAllAccounts() bool {
	if a.store == nil {
		return false
	}
	val, err := a.store.GetAppState("show_all_accounts")
	if err != nil {
		return false
	}
	return val == "true"
}

// SetShowAllAccounts sets whether to show accounts with no data for today.
func (a *App) SetShowAllAccounts(enabled bool) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	if enabled {
		return a.store.SetAppState("show_all_accounts", "true")
	}
	return a.store.SetAppState("show_all_accounts", "false")
}

// RecordAndLearnQuota checks current quota info and records exhaustion events.
// Called during data refresh to learn from quota limits.
// RecordAndLearnQuota checks quota status and records learning data.
// Detection sources (in priority order):
//  1. 4031 error log (legacy, may not work on newer Trae IDE)
//  2. Counter-based: identityStr from storage.json + daily conversation count vs known quota
func (a *App) RecordAndLearnQuota() {
	if a.store == nil || a.counter == nil {
		return
	}

	info, err := traedb.GetQuotaInfo(traedb.DefaultTraeDataPath)
	if err != nil || info == nil {
		return
	}

	lastActive, err := a.counter.GetLastActiveUser()
	if err != nil || lastActive == "" {
		return
	}

	today := time.Now().Format("2006-01-02")

	// #region debug-point quota-limit-detection
	// Get today's conversation count for logging
	todayCount, _ := a.store.GetLedgerCountByUserDate(lastActive, today)
	learnedQuota, _ := a.store.GetLearnedQuota(lastActive)
	traedb.QuotaDebugLog("[RecordAndLearnQuota] user=%s today=%s todayCount=%d learnedQuota=%d info.Quota=%d info.Used=%d info.IsExhausted=%v info.ExhaustSource=%s info.IdentityStr=%s",
		lastActive, today, todayCount, learnedQuota, info.Quota, info.Used, info.IsExhausted, info.ExhaustSource, info.IdentityStr)
	// #endregion debug-point quota-limit-detection

	// Source 1: 4031 error log (highest confidence when available)
	if info.Quota > 0 && info.ExhaustSource == "4031_log" {
		// #region debug-point quota-limit-detection
		traedb.QuotaDebugLog("[RecordAndLearnQuota] Source1 4031_log: quota=%d used=%d isExhausted=%v", info.Quota, info.Used, info.IsExhausted)
		// #endregion debug-point quota-limit-detection
		if info.IsExhausted {
			a.store.RecordQuotaExhaustion(lastActive, today, info.Used, info.Quota)
		} else {
			a.store.RecordQuotaFromLog(lastActive, today, info.Quota)
		}
	}

	// Source 2: Counter-based detection
	// Get today's conversation count for this user
	todayCount, err = a.store.GetLedgerCountByUserDate(lastActive, today)
	if err == nil && todayCount > 0 {
		// Get the current known quota for this user
		knownQuota := info.Quota
		if knownQuota == 0 {
			// Try learned quota as fallback
			if learned, err := a.store.GetLearnedQuota(lastActive); err == nil {
				knownQuota = learned
			}
		}
		if knownQuota == 0 {
			// Hardcoded fallback based on identity
			if info.IdentityStr == "Free" {
				knownQuota = 58
			} else {
				knownQuota = 500
			}
		}

		// #region debug-point quota-limit-detection
		traedb.QuotaDebugLog("[RecordAndLearnQuota] Source2 counter: todayCount=%d knownQuota=%d (source: info.Quota=%d, learned=%d, hardcoded=%s) willRecordExhaustion=%v",
			todayCount, knownQuota, info.Quota, learnedQuota,
			func() string {
				if info.Quota > 0 {
					return "info.Quota"
				}
				if learnedQuota > 0 {
					return "learned"
				}
				return "hardcoded"
			}(),
			info.IsExhausted || todayCount >= knownQuota)
		// #endregion debug-point quota-limit-detection

		// Detect exhaustion: today's count >= known quota
		// OR was already detected exhausted by log sources
		if info.IsExhausted || todayCount >= knownQuota {
			// Determine source and observed_quota based on detection method
			source := "counter_exhaustion"
			observedUsed := todayCount
			observedQuota := 0 // Default: we don't know the actual quota

			if info.ExhaustSource == "4031_log" {
				// 4031 error gives us the exact quota from API
				source = "exhaustion_4031"
				observedQuota = info.Quota
			} else if info.ExhaustSource == "renderer_log" {
				// fast_request_toggle disabled means "fast request" feature is disabled,
				// NOT that the total quota is exhausted. The user can still send normal messages.
				// We cannot infer the actual quota from this event, so record 0.
				source = "exhaustion_renderer_log"
				observedQuota = 0
				observedUsed = todayCount
				traedb.QuotaDebugLog("[RecordAndLearnQuota] renderer_log: fast_request disabled detected but cannot infer quota, using observedQuota=0")
			} else if todayCount >= knownQuota {
				// Counter-based: count exceeded known quota
				source = "counter_exhaustion"
				observedQuota = knownQuota
			}

			// #region debug-point quota-limit-detection
			traedb.QuotaDebugLog("[RecordAndLearnQuota] RECORDING exhaustion: user=%s date=%s observedUsed=%d observedQuota=%d source=%s",
				lastActive, today, observedUsed, observedQuota, source)
			// #endregion debug-point quota-limit-detection

			a.store.RecordQuotaExhaustionWithSource(lastActive, today, observedUsed, observedQuota, source)
		}
	}

	// Source 3 is now handled within Source 2 above (using proper source names)

	// If auto-threshold is enabled, adjust thresholds based on learned quota
	autoThreshold := false
	val, err := a.store.GetAppState("auto_threshold")
	if err == nil && val == "true" {
		autoThreshold = true
	}

	if autoThreshold {
		learned, err := a.store.GetLearnedQuota(lastActive)
		if err == nil && learned > 0 {
			newWarning := learned - 10
			newAlert := learned - 5
			if newWarning < 5 {
				newWarning = 5
			}
			if newAlert <= newWarning {
				newAlert = newWarning + 5
			}
			a.store.SetAppState("warning_threshold", strconv.Itoa(newWarning))
			a.store.SetAppState("alert_threshold", strconv.Itoa(newAlert))
		}
	}
}
