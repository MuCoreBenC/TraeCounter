#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#   Trae 对话计数 — 指定版本构建
#   双击此文件，输入版本号即可构建 app + dmg
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cd "$(dirname "$0")"

echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "    Trae 对话计数 — 指定版本构建"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 获取当前版本（从 git tag）
CURRENT_VERSION=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "0.0.0")
echo "  当前版本:  v${CURRENT_VERSION}"

# 计算建议的下一版本（patch +1）
MAJOR=$(echo "${CURRENT_VERSION}" | cut -d. -f1)
MINOR=$(echo "${CURRENT_VERSION}" | cut -d. -f2)
PATCH=$(echo "${CURRENT_VERSION}" | cut -d. -f3)
NEXT_PATCH=$((PATCH + 1))
SUGGESTED="${MAJOR}.${MINOR}.${NEXT_PATCH}"

echo "  建议版本:  v${SUGGESTED}"
echo ""
echo "  输入版本号后回车开始构建"
echo "  · 直接回车使用建议版本"
echo "  · 输入 q 退出"
echo ""

# 提示用户输入
read -p "  请输入版本号 [${SUGGESTED}]: " INPUT_VERSION

# 退出
if [ "${INPUT_VERSION}" = "q" ] || [ "${INPUT_VERSION}" = "Q" ]; then
    echo ""
    echo "  已取消"
    echo ""
    exit 0
fi

# 使用建议版本或用户输入
if [ -z "${INPUT_VERSION}" ]; then
    VERSION="${SUGGESTED}"
else
    # 去掉前缀 v
    VERSION=$(echo "${INPUT_VERSION}" | sed 's/^v//')
fi

echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  开始构建 v${VERSION}..."
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 调用 build.sh
./build.sh "${VERSION}"
BUILD_EXIT=$?

echo ""
if [ ${BUILD_EXIT} -eq 0 ]; then
    echo "  ✓ 构建成功: v${VERSION}"
    echo ""
    echo "  产物位置:"
    echo "    · App:  build/bin/Trae对话计数.app"
    echo "    · DMG:  build/bin/Trae对话计数-${VERSION}.dmg"
else
    echo "  ✗ 构建失败 (exit code: ${BUILD_EXIT})"
fi

echo ""
echo "  按回车键关闭..."
read
