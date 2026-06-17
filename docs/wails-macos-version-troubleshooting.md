# Wails v2 + cgo + macOS：About 面板与"显示简介"版本号问题排查指南

> 本文档记录了 trae-counter 项目中三个版本号相关 Bug 的根因与修复方法，
> 适用于任何使用 **Wails v2 + cgo + macOS** 的桌面应用。

---

## 问题一览

| # | 现象 | 根因 | 涉及层 |
|---|------|------|--------|
| 1 | About 面板版本号显示 `(null)` | cgo 桥接 use-after-free | Go ↔ C (Objective-C) |
| 2 | Finder"显示简介"版本号是 `1.0.0` | `wails.json` 缺少 `info` 字段 | Wails 构建配置 |
| 3 | "显示简介"版权信息为空/错误 | `wails.json` 缺少 `info.copyright` | Wails 构建配置 |

---

## Bug 1：About 面板版本号显示 `(null)`

### 根因：cgo 桥接中的 use-after-free

当 Go 通过 cgo 调用 C 函数，且 C 函数内部使用 `dispatch_async` 异步执行时，
Go 端的 `defer C.free()` 会在 Go 函数返回时**立即释放** C 字符串内存，
但 `dispatch_async` 的 block 要等到主线程空闲时才执行——此时指针已悬空。

**错误模式：**

```go
// Go 端 — 错误！
func SetupAppMenu(version string) {
    cVersion := C.CString(version)
    defer C.free(unsafe.Pointer(cVersion)) // ← 函数返回时立即释放
    C.tcSetupAppMenu(cVersion)             // C 函数内部 dispatch_async 异步执行
}
```

```c
// C 端 — 错误！
void tcSetupAppMenu(const char *version) {
    dispatch_async(dispatch_get_main_queue(), ^{
        // 此时 version 指针已被 Go 的 defer C.free() 释放！
        NSString *ver = [NSString stringWithUTF8String:version]; // → nil
        // [NSString stringWithFormat:@"版本 %@", ver] → "版本 (null)"
    });
}
```

### 修复方法：在 `dispatch_async` 之前复制字符串

```go
// Go 端 — 保持不变（defer C.free 仍然正确）
func SetupAppMenu(version string) {
    cVersion := C.CString(version)
    defer C.free(unsafe.Pointer(cVersion))
    C.tcSetupAppMenu(cVersion)
}
```

```c
// C 端 — 修复！在 dispatch_async 之前复制为 NSString
void tcSetupAppMenu(const char *version) {
    // 在 dispatch_async 之前复制！Go 的 defer C.free() 在本函数返回时执行，
    // 但 dispatch block 异步执行——届时 version 指针已失效。
    NSString *verCopy = version ? [NSString stringWithUTF8String:version] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *ver = verCopy ?: @"未知";
        // 正常使用 ver...
    });
}
```

**关键原则：** 任何跨 cgo 边界传递的指针，如果在 C 端被异步使用（`dispatch_async`、
回调、定时器等），都必须在异步边界之前复制到 C/Objective-C 自己管理的内存中。

### 涉及文件

| 文件 | 作用 |
|------|------|
| `internal/native/native_darwin.go` | Go ↔ C 桥接层，`defer C.free()` 所在 |
| `internal/native/native_other.go` | 非 macOS 平台的 stub |
| `app.go` | 调用 `native.SetupAppMenu(version.Get())` 的地方 |
| `internal/version/version.go` | 版本号源（通过 ldflags 注入） |

---

## Bug 2 & 3：Finder"显示简介"版本号 1.0.0 / 版权信息错误

### 根因：`wails.json` 缺少 `info` 字段

Wails v2 在构建时读取 `wails.json` 的 `info` 字段，用来填充 macOS `Info.plist`
模板中的版本号和版权信息。如果 `info` 字段缺失，模板变量为空，macOS 会回退到
默认值 `1.0.0`。

**Info.plist 模板变量映射：**

| Info.plist Key | 模板变量 | wails.json 字段 | 作用 |
|----------------|----------|-----------------|------|
| `CFBundleVersion` | `{{.Info.ProductVersion}}` | `info.productVersion` | 构建版本号 |
| `CFBundleShortVersionString` | `{{.Info.ProductVersion}}` | `info.productVersion` | 显示版本号 |
| `NSHumanReadableCopyright` | `{{.Info.Copyright}}` | `info.copyright` | 版权信息 |
| `CFBundleGetInfoString` | `{{.Info.Comments}}` | `info.comments` | 附加信息 |

### 修复方法

**1. 在 `wails.json` 中添加 `info` 字段：**

```json
{
  "name": "your-app",
  "outputfilename": "your-app",
  "info": {
    "productName": "你的应用名",
    "productVersion": "1.0.0",
    "copyright": "© 2026 你的名字",
    "comments": "你的许可证"
  }
}
```

**2. 在构建脚本中动态更新版本号：**

由于 `wails.json` 是静态文件，而版本号通常来自 git tag，需要在构建前临时更新：

```bash
# 保存原始 wails.json
cp wails.json wails.json.version-bak
trap 'mv wails.json.version-bak wails.json 2>/dev/null || true' EXIT

# 用 sed 更新 productVersion（macOS 语法）
sed -i '' "s/\"productVersion\": \".*\"/\"productVersion\": \"${VERSION}\"/" wails.json

# 构建
wails build -platform darwin/universal -ldflags "-X yourmodule/internal/version.Version=${VERSION}"
```

**关键点：**
- `trap ... EXIT` 确保构建完成后恢复原始 `wails.json`，避免 git 工作区变脏
- `sed -i ''` 是 macOS 语法（Linux 用 `sed -i`）
- `-ldflags "-X ...version.Version=${VERSION}"` 注入 Go 运行时版本号（用于 About 面板等动态显示）
- `wails.json` 的 `info.productVersion` 注入 Info.plist（用于 Finder"显示简介"等静态显示）

### 涉及文件

| 文件 | 作用 |
|------|------|
| `wails.json` | Wails 构建配置，`info` 字段填充 Info.plist |
| `build.sh` | 构建脚本，动态更新版本号 |
| `build/darwin/Info.plist` | 正式构建的 plist 模板 |
| `build/darwin/Info.dev.plist` | 开发构建的 plist 模板 |
| `internal/version/version.go` | Go 运行时版本号（ldflags 注入） |

---

## 诊断方法

### 诊断 Bug 1（About 显示 null）

1. **检查 Go 端是否有 `defer C.free` + C 端有 `dispatch_async` 的组合**
   — 这是 use-after-free 的标志

2. **添加文件日志（NSLog 会被 macOS 隐私保护屏蔽为 `<private>`）**
   ```c
   FILE *f = fopen("/tmp/your-app-debug.log", "a");
   if (f) {
       fprintf(f, "version ptr=%p, value=%s\n", version, version ? version : "NULL");
       fclose(f);
   }
   ```

3. **如果日志显示 value 是乱码或空字符串**，确认是 use-after-free

### 诊断 Bug 2 & 3（显示简介 1.0.0）

1. **检查 `wails.json` 是否有 `info` 字段**
2. **检查 `build/darwin/Info.plist` 模板使用的变量**
3. **构建后检查实际 Info.plist：**
   ```bash
   /usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "build/bin/YourApp.app/Contents/Info.plist"
   /usr/libexec/PlistBuddy -c "Print NSHumanReadableCopyright" "build/bin/YourApp.app/Contents/Info.plist"
   ```

---

## 版本号注入的两条路径

```
┌─────────────────────────────────────────────────────────┐
│  git tag (v0.2.10)                                       │
│                                                          │
│  路径 A：Go 运行时版本（About 面板、应用内显示）            │
│  ─────────────────────────────────────────                │
│  build.sh → -ldflags "-X .../version.Version=0.2.10"    │
│           → Go 代码 version.Get() 返回 "0.2.10"          │
│           → native.SetupAppMenu("0.2.10")                │
│           → About 面板显示 "版本 0.2.10"                  │
│                                                          │
│  路径 B：Info.plist 版本（Finder 显示简介）                │
│  ─────────────────────────────────────────                │
│  build.sh → sed 更新 wails.json info.productVersion      │
│           → wails build 读取 wails.json                  │
│           → 填充 Info.plist {{.Info.ProductVersion}}     │
│           → Finder 显示简介显示 "0.2.10"                  │
└─────────────────────────────────────────────────────────┘
```

**两条路径独立运作，缺一不可。** 只修 A 不修 B，About 面板正常但 Finder 仍显示 1.0.0；
只修 B 不修 A，Finder 正常但 About 面板显示 null 或 dev。
