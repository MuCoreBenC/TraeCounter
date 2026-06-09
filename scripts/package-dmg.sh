#!/bin/bash
set -euo pipefail

# ─── Trae 对话计数 — DMG 打包脚本 ─────────────────────────────────
# Usage:
#   ./scripts/package-dmg.sh              # Package DMG with version from git tag
#   ./scripts/package-dmg.sh 0.3.0        # Package DMG with specified version
# ─────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")/.."

# ─── Version ─────────────────────────────────────────────────────────
if [ -n "${1:-}" ]; then
    VERSION="$1"
else
    VERSION=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "dev")
fi

APP_DISPLAY_NAME="Trae 对话计数"
APP_BUNDLE_NAME="Trae对话计数.app"
APP_DIR="dist/darwin/${APP_BUNDLE_NAME}"
DMG_NAME="Trae对话计数-${VERSION}"
DMG_PATH="${DMG_NAME}.dmg"

echo "========================================="
echo "  ${APP_DISPLAY_NAME} v${VERSION} — DMG Packaging"
echo "========================================="

# ─── Step 1: Verify .app exists ────────────────────────────────────
echo ""
echo "[1/3] Verifying app bundle..."

if [ ! -d "${APP_DIR}" ]; then
    echo "ERROR: App not found at ${APP_DIR}"
    echo "  Please copy the compiled .app to dist/darwin/ first."
    exit 1
fi

echo "  ✓ Found: ${APP_DIR}"

# ─── Step 2: Create writable DMG ────────────────────────────────────
echo ""
echo "[2/3] Creating DMG..."

rm -f "${DMG_PATH}"
TMP_DMG="${DMG_NAME}_writable.dmg"
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

# Copy app, Applications symlink, and background
cp -R "${APP_DIR}" "${MOUNT_DIR}/"
ln -s /Applications "${MOUNT_DIR}/Applications"

# Copy background image and hide it
DMG_BACKGROUND="build/dmg/background.png"
if [ -f "${DMG_BACKGROUND}" ]; then
    cp "${DMG_BACKGROUND}" "${MOUNT_DIR}/.background.png"
fi

# Set Finder window layout
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
        set position of item "'"${APP_BUNDLE_NAME}"'" of container window to {160, 160}
        set position of item "Applications" of container window to {460, 160}
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

# ─── Step 3: Verify ─────────────────────────────────────────────────
echo ""
echo "[3/3] Verifying..."

if [ -f "${DMG_PATH}" ]; then
    echo "  ✓ DMG created successfully"
else
    echo "  ✗ DMG creation failed"
    exit 1
fi

# ─── Done ────────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  DMG Packaging Complete!"
echo "========================================="
echo ""
echo "  App:     ${APP_DIR}"
echo "  DMG:     ${DMG_PATH}"
echo "  Version: ${VERSION}"
echo "  Size:    $(du -sh "${DMG_PATH}" | cut -f1)"
echo ""
