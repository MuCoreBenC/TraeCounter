#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#   修复「应用已损坏」提示 — 双击运行此文件
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

clear

echo "┌─────────────────────────────────────────────┐"
echo "│            修复「应用已损坏」提示           │"
echo "└─────────────────────────────────────────────┘"
echo ""

APP_NAME="Trae对话计数.app"
APP_SOURCE="/Volumes/Trae 对话计数/${APP_NAME}"
APP_DEST="/Applications/${APP_NAME}"

# Step 1: Check if app is already in /Applications
if [ -d "${APP_DEST}" ]; then
    echo "  ✓ 已检测到应用在 /Applications 中"
else
    # Step 2: Check if DMG is still mounted and app is there
    if [ -d "${APP_SOURCE}" ]; then
        echo "  检测到应用尚未移入 Applications，正在自动移动..."
        echo ""
        echo "  将执行：cp -R \"${APP_SOURCE}\" \"/Applications/\""
        echo ""
        cp -R "${APP_SOURCE}" "/Applications/"
        if [ $? -eq 0 ]; then
            echo "  ✓ 应用已移动到 /Applications"
        else
            echo "  ✗ 自动移动失败，请手动将应用拖入 Applications 文件夹"
            echo ""
            echo "  按回车键关闭..."
            read
            exit 1
        fi
    else
        echo "  ✗ 未找到应用，请先将应用拖入 Applications 文件夹"
        echo ""
        echo "  按回车键关闭..."
        read
        exit 1
    fi
fi

echo ""
echo "  为什么会出现「已损坏」提示？"
echo "    macOS 对未签名的应用会显示此提示，"
echo "    这是系统安全机制，并非应用本身有问题。"
echo ""
echo "  本脚本将执行以下命令："
echo "    sudo xattr -r -d com.apple.quarantine /Applications/Trae对话计数.app"
echo ""
echo "  此命令仅移除系统的隔离标记，不会修改应用。"
echo "  需要输入的是您的电脑登录密码（输入时不会显示）。"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

sudo xattr -r -d com.apple.quarantine "${APP_DEST}"

if [ $? -eq 0 ]; then
    echo ""
    echo "  ✓ 修复成功！现在可以正常打开应用了。"
else
    echo ""
    echo "  ✗ 修复失败，请确认输入了正确的电脑登录密码"
fi

echo ""
echo "  按回车键关闭..."
read
