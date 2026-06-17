#!/bin/bash
set -euo pipefail

# ─── Trae 对话计数 — 构建脚本 ────────────────────────────────────────
# Usage:
#   ./build.sh              # Build app + dmg with version from git tag
#   ./build.sh 0.3.0        # Build app + dmg with specified version
# ─────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")"

# ─── Version ─────────────────────────────────────────────────────────
if [ -n "${1:-}" ]; then
    VERSION="$1"
else
    VERSION=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "dev")
fi

APP_NAME="trae-counter"
APP_DISPLAY_NAME="Trae 对话计数"
APP_BUNDLE_NAME="Trae对话计数.app"
APP_DIR="build/bin/${APP_NAME}.app"
DMG_NAME="Trae对话计数-${VERSION}"
DMG_PATH="build/bin/${DMG_NAME}.dmg"
QUARANTINE_SCRIPT="build/dmg/修复应用损坏.command"

echo "========================================="
echo "  ${APP_DISPLAY_NAME} v${VERSION}"
echo "========================================="

# ─── Step 1: Build Universal Binary ─────────────────────────────────
echo ""
echo "[1/4] Building universal binary (Intel + Apple Silicon)..."

# Temporarily update wails.json info.productVersion so the baked Info.plist
# shows the correct version in Finder "Get Info". Restore on exit.
cp wails.json wails.json.version-bak
trap 'mv wails.json.version-bak wails.json 2>/dev/null || true' EXIT
sed -i '' "s/\"productVersion\": \".*\"/\"productVersion\": \"${VERSION}\"/" wails.json

wails build -platform darwin/universal -ldflags "-X trae-counter/internal/version.Version=${VERSION}"

if [ ! -d "${APP_DIR}" ]; then
    echo "ERROR: Build failed - app not found at ${APP_DIR}"
    exit 1
fi

echo "  ✓ Built: ${APP_DIR}"

# Rename app bundle to Chinese display name (Finder shows directory name for .app)
if [ "${APP_DIR}" != "build/bin/${APP_BUNDLE_NAME}" ]; then
    rm -rf "build/bin/${APP_BUNDLE_NAME}"
    mv "${APP_DIR}" "build/bin/${APP_BUNDLE_NAME}"
    echo "  ✓ Renamed to: build/bin/${APP_BUNDLE_NAME}"
fi

# ─── Step 2: Create writable DMG ────────────────────────────────────
echo ""
echo "[2/4] Creating writable DMG..."

rm -f "${DMG_PATH}"
TMP_DMG="build/bin/${DMG_NAME}_writable.dmg"
rm -f "${TMP_DMG}"

hdiutil create -volname "${APP_DISPLAY_NAME}" \
    -fs HFS+ \
    -fsargs "-c c=64,a=16,e=16" \
    -size 200m \
    "${TMP_DMG}"

# Mount and get the mount point
MOUNT_OUTPUT=$(hdiutil attach -readwrite -noverify -noautoopen "${TMP_DMG}" 2>&1)
MOUNT_DIR=$(echo "${MOUNT_OUTPUT}" | grep '/Volumes/' | head -1 | sed 's|^.*\(/Volumes/.*\)|\1|' | sed 's/[[:space:]]*$//')

echo "  Mounted at: ${MOUNT_DIR}"

# Copy app, Applications symlink, background, and quarantine script
cp -R "build/bin/${APP_BUNDLE_NAME}" "${MOUNT_DIR}/"
ln -s /Applications "${MOUNT_DIR}/Applications"

# Copy background image and hide it
DMG_BACKGROUND="build/dmg/background.png"
if [ -f "${DMG_BACKGROUND}" ]; then
    cp "${DMG_BACKGROUND}" "${MOUNT_DIR}/.background.png"
fi

if [ -f "${QUARANTINE_SCRIPT}" ]; then
    cp "${QUARANTINE_SCRIPT}" "${MOUNT_DIR}/"
fi

# ─── Step 3: Set Finder window layout ───────────────────────────────
echo ""
echo "[3/4] Setting Finder layout..."

# Use osascript to set icon positions (macOS has no 'timeout', use perl instead)
# Layout: app on left, Applications on right, script below right
# Note: Use the mounted volume name (may differ from display name due to macOS appending numbers)
VOLUME_NAME=$(basename "${MOUNT_DIR}")
perl -e 'alarm 20; exec @ARGV' osascript -e '
tell application "Finder"
    set dmgDisk to disk "'"${VOLUME_NAME}"'"
    tell dmgDisk
        open
        delay 2
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {100, 100, 700, 540}
        set theViewOptions to the icon view options of container window
        set arrangement of theViewOptions to not arranged
        set icon size of theViewOptions to 96
        try
            set background picture of theViewOptions to file ".background.png"
        end try
        set position of item "'"${APP_BUNDLE_NAME}"'" of container window to {160, 100}
        set position of item "Applications" of container window to {460, 100}
        try
            set position of item "修复应用损坏.command" of container window to {460, 280}
        end try
        close
        open
        update without registering applications
        delay 3
    end tell
end tell
' 2>&1 || echo "  Warning: layout setup failed, using default"

sync
sleep 1

# Detach
hdiutil detach "${MOUNT_DIR}" -quiet
sleep 1

# Convert to compressed read-only DMG
echo "  Compressing..."
hdiutil convert "${TMP_DMG}" \
    -format UDZO \
    -imagekey zlib-level=9 \
    -o "${DMG_PATH}" \
    -quiet

rm -f "${TMP_DMG}"

# ─── Step 4: Verify ─────────────────────────────────────────────────
echo ""
echo "[4/4] Verifying..."

if [ -f "${DMG_PATH}" ]; then
    echo "  ✓ DMG created successfully"
else
    echo "  ✗ DMG creation failed"
    exit 1
fi

# ─── Done ────────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  Build Complete!"
echo "========================================="
echo ""
echo "  App:     ${APP_DIR}"
echo "  DMG:     ${DMG_PATH}"
echo "  Version: ${VERSION}"
echo "  Size:    $(du -sh "${DMG_PATH}" | cut -f1)"
echo ""
