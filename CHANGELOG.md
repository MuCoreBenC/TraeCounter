# Changelog

## v0.2.8

### 修复

- **配额检测 findLatestLogDir 返回错误目录**：`aha_log` 按字母排序最大但不含 Modular/window 子目录，导致 ai-agent 日志和 renderer 日志检测全部失败。改为优先选择时间戳格式目录（`20260609T172524`），跳过 `aha_log`
- **4031 错误检测误报**：AI 读取源代码时 `toolcall_resp` 中包含 `error_code:4031` 字符串被误匹配为真实 API 错误。新增 `is4031FalsePositive()` 过滤 `commit_toolcall_result`、`RUN_CMD_S/E`、`regexp.MustCompile` 来源
- **renderer log 检测只搜索最新目录**：`checkRendererLogsForExhaustion` 和 `GetLatestExhaustionTime` 只搜索 `findLatestLogDir` 返回的单一目录。改为搜索最近 3 个日志目录
- **fast_request_toggle disabled 不能推断配额上限**：`fast_request_toggle disabled` 只表示"快速请求"功能被禁用（约 50 次），不是总配额耗尽（实际约 60 次）。用户仍可继续发消息，导致 `observed_used` 远超实际配额。修复：renderer_log 来源不再参与配额学习（`observed_quota=0`，加权算法中 `continue` 跳过），`GetLearnedQuotaForDate` fallback 只用高置信度来源
- **颜色/通知被全局 quotaInfo.is_exhausted 污染**：`quotaInfo.is_exhausted` 来自当前 Trae 登录账号的状态，查看其他账号时错误地影响颜色和通知。改为只根据 `effectiveQuota`（按用户区分的 `learnedQuota` 或 `manualQuota`）和 `count` 判断
- **通知反复弹出**：每次刷新都重新检测到耗尽状态并发通知。改为用 `app_state` 表按用户+日期持久化记录通知状态，每种通知类型每个用户每天只发一次，应用重启后也不会重复
- **切换账号后 Trae 不能自动重新打开**：`openTrae` 只执行一次 `open -a`，Trae 还在退出时命令可能失败。改为重试 3 次（每次验证进程是否启动），等待时间从 500ms 改为 2s
- **切换账号后窗口被 Trae 压到后面**：切换开始时 `WindowSetAlwaysOnTop(true)` 置顶，完成后取消置顶并调用 `WindowShow()` 保持窗口在最前面

### 改进

- **Vite HMR WebSocket 配置**：显式设置 `protocol: 'ws', host: 'localhost'`，修复 dev 模式下 `localhost:undefined` 和 ATS 安全策略导致的连接失败
- **清理未使用变量**：移除 `FluidChart` 未使用的 `quotaLimit` 参数、`notifiedExhaustedRef`/`notifiedAlertRef`/`notifiedWarningRef` 内存 ref

## v0.2.7

### 修复

- **切换用户后当前用户显示不更新（根因修复）**：`counter.go` 的 `Refresh()` 和 `SyncHistory()` 在每次执行时，会用最新对话 tag 的 UserID 覆盖 `last_active_user`。切换用户后，最新对话 tag 仍属于旧用户，导致 `last_active_user` 被重置回旧用户 ID，覆盖了 `autoSaveOnStorageChange` 通过 JWT 验证设置的正确值。现在仅当 `last_active_user` 为空（首次启动）时才设置，切换后的用户身份更新完全交给 `autoSaveOnStorageChange`（使用 JWT token 验证，是最可靠的机制）
- **切换用户后 UI 长时间显示旧用户数据**：`refreshData` 中 `GetLastActiveUser()` 在切换期间返回旧值，`setCurrentTraeUserId` 会覆盖前端已设置的新用户 ID。现在切换期间不更新 `currentTraeUserId` 和 `lastActiveUserId`，由 `currentUserChanged` 事件作为唯一权威来源
- **切换期间弹出旧用户通知**：`checkAndNotify` 不检查是否正在切换，导致旧用户的通知阈值被触发。现在切换期间跳过通知检查
- **切换后 autoSave 用 log detection 覆盖新用户**：JWT 为空时（Trae 正在启动），`autoSaveOnStorageChange` 用 log detection 返回旧用户 ID 覆盖了 `SwitchUser` 设置的正确新用户 ID。现在 JWT 为空时保持目标用户 ID，等 post-open monitor 通过 JWT 验证
- **切换时大数字显示优化**：切换确认后立即显示 `—` 加载占位符，不再显示旧用户数据

### 新增

- **拍快照/删快照确认模态框**：操作前弹出确认对话框，拍快照显示当前 Trae 登录状态提示，删快照显示不可撤销警告，防止误操作

### 背景

v0.2.6 修复了多个账号切换相关的问题（误判"已经是当前账号"、凭证双重编码、前端不更新等），但在实际使用中发现切换成功后账号管理页面仍显示旧用户为"当前"用户。通过添加调试日志定位到根因：`autoSaveOnStorageChange` 每次都正确地将 `last_active_user` 修正为新用户的 JWT user_id，但下一次 `Refresh()` 触发时又用旧用户的对话 tag 把它覆盖回去了。本次修复彻底解决了这个竞态问题。

## v0.2.6

### 修复

- **账号切换误判"已经是当前账号"**：切换用户后日志未更新，`GetCurrentTraeUserID` 从日志读到旧用户导致误判。改为优先使用 DB 的 `last_active_user`（切换时立即更新），仅在 DB 无值时回退到日志检测
- **凭证双重编码导致切换失败**：`ReadAuthCredentials`/`WriteAuthCredentials` 使用 `string()` 转换 `json.RawMessage` 导致双重 JSON 编码，写入的凭证 Trae 无法解密。改为直接使用 `json.RawMessage` 保留原始编码
- **切换后前端不更新当前用户**：`autoSaveOnStorageChange` 在凭证数据相同时跳过发送 `currentUserChanged` 事件，导致前端 `currentTraeUserId` 未更新。改为始终发送事件
- **未登录时无法切回已有凭证的账号**：`SwitchUser` 在 `IsTraeLoggedIn` 返回 false 时跳过当前用户判断，允许切换任何用户
- **刷新按钮未检测登录状态**：前端 `refreshData` 中集成 `IsTraeLoggedIn` 检查，未登录时所有按钮显示"切换"
- **`RestartTrae` 不真正重启**：从仅 `activate` 改为先 `quit` 再 `open`，确保凭证变更生效
- **`autoSaveOnStorageChange` 用户检测不准**：凭证数据与 `last_active_user` 不匹配时，从日志检测新用户并更新 `last_active_user`

## v0.2.5

### 新增

- **智能阈值**：根据学习到的额度上限自动调整提醒/警告阈值（学习上限 - 10 / 学习上限 - 5），无需手动设置
- **额度学习系统**：多来源检测额度耗尽（4031 错误日志 > 渲染日志 fast_request_toggle > storage.json），加权算法计算学习上限，近期数据权重更高
- **额度耗尽检测**：实时检测 Trae 额度耗尽状态，多来源交叉验证（renderer log fast_request_toggle disabled 事件、4031 错误日志）
- **历史日期导航**：今日视图中左右箭头浏览历史日期的每小时分布，支持长按快速翻页，顶部显示日期标签（昨天 / N天前）
- **图表额度红线**：折线图显示额度上限虚线，超出部分区域填充红色，直观显示额度使用情况
- **手动额度上限**：智能阈值关闭时可手动设置额度上限（默认 58），用于图表红线和大数字变色
- **显示全部账号**：下拉菜单中可选择显示当天无数据的账号
- **快速请求剩余**：设置面板额度信息区显示 fast_request_per
- **耗尽检测来源**：额度信息区显示检测来源（storage.json / 渲染日志 / 4031 错误）

### 改进

- **液态玻璃按钮**：日期导航使用统一的 GlassCircleButton 组件，极简透明玻璃风格
- **时间切换器模糊**：backdrop-filter 从 2px 降为 1px，更轻量
- **单账号隐藏序号**：只有一个账号时不显示角标序号
- **切换账号重置日期**：切换账号时自动回到今日视图
- **右侧布局优化**：账号选择区域改为固定 35% 宽度，不影响左侧居中

## v0.2.4

### 新增

- **用户备注**：为每个账号添加自定义备注（如"工作主号"、"6月11日注销"），有备注时主行显示备注名，原用户名移至副行
- **账号管理展开详情**：展开显示首次记录日期、最后活跃时间、自动/手动统计，支持切换用户和删除
- **用户切换**：冻结当前用户凭证 → 解冻目标用户凭证，切换后提示重启 Trae IDE
- **凭证管理**：`user_credentials` 表存储冻结的用户凭证，支持保存/加载/删除/查询
- **重启应用**：设置面板和状态栏菜单均可重启应用，开发模式下自动降级为刷新前端
- **状态栏重启菜单**：macOS 菜单栏新增"重启应用"选项

### 修复

- **深色模式图表无渐变**：折线图面积填充从纯色改为渐变（与明亮模式一致）
- **账号管理颜色不一致**：列表项 hover、展开区域背景/边框/阴影对齐参考设计原型
  - hover: `hover:bg-gray-50 dark:hover:bg-white/[0.03]`
  - 展开区域: `bg-gray-50 dark:bg-black/20 shadow-inner border-t border-gray-100 dark:border-transparent`
  - 分隔线: `border-gray-100 dark:border-[#333]`
- **账号管理页面背景色**：从 `dark:bg-[#1e1e1e]` 改为 `dark:bg-[#252526]`，与标题栏一致

### 改进

- **窗口尺寸调整**：默认 520×390，最小 340×255，最大 720×540
- **README 更新**：补充用户备注、账号管理、重启应用等功能说明

## v0.2.3

### 改进

- **默认视图改为「今日」**：打开应用默认显示当日每小时消息分布，更直观了解当天使用节奏
- **液态玻璃时间切换器**：底部时间切换器改为极简透明玻璃风格（blur 2px + 极细边框），悬停 pill 本身才显示，不遮挡图表
- **账号管理界面优化**：展开行中的长用户 ID 从横排改为用户名下方浅灰色副标题，避免换行和遮挡
- **深色/明亮模式玻璃质感微调**：明亮模式边框改为浅灰色细线，深色模式指示器高光减弱

## v0.2.2

### 新增

- **应用中文名**：应用在 Finder/Launchpad 中显示为「Trae 对话计数」
- **DMG 安装包**：`./build.sh` 一键构建 app + dmg，DMG 包含 Applications 快捷方式和修复脚本
- **一键构建**：双击 `一键构建.command` 即可构建，无需记忆命令
- **智能修复脚本**：`修复应用损坏.command` 双击运行，自动检测并移动 app 到 Applications，再移除隔离标记；所有文案在终端中展示，包含命令说明

### 修复

- **状态栏计数与 UI 不同步**：切换用户时状态栏/Touch Bar 不更新为选中用户的计数
- **SyncHistory 后状态栏不更新**：启动时状态栏显示旧数据
- **App 在 Finder 中显示英文名**：构建后自动重命名为 `Trae对话计数.app`，设置 `CFBundleDisplayName`

### 改进

- **DMG 文件名**：`Trae对话计数-{version}.dmg`，中文名更直观
- **DMG 卷标**：挂载后显示「Trae 对话计数」
- **构建脚本**：`build.sh` 支持 Universal 二进制 + 中文文件名 + AppleScript 布局

## v0.2.1

### 修复

- **通知内容为空（悬空指针）**：`dispatch_async` 异步块内读取 C 字符串时，Go 的 `defer C.free` 已释放内存，导致通知只播放声音不显示内容。修复：在 `dispatch_async` 之前将 C 字符串复制为 NSString
- **通知不显示横幅（macOS 11+）**：`willPresentNotification` 使用已废弃的 `UNNotificationPresentationOptionAlert`，其值在新枚举中等于 `Sound`，导致只播放声音不显示横幅。修复：macOS 11+ 使用 `Banner | List | Sound`
- **fsnotify 实时监听延迟**：直接监听 `v2/.git/refs/tags` 子目录（之前只监听 session 目录，tag 文件变化无法检测，导致十几秒延迟）
- **移除 fallback 轮询**：fsnotify 现在能正确检测 tag 变化，不再需要 30 秒保底轮询
- **Store 初始化失败导致 nil panic**：初始化失败时 `log.Fatalf` 退出应用
- **SQLite 并发锁死**：添加 `_busy_timeout=5000&_journal_mode=WAL` + `SetMaxOpenConns(1)`
- **dlclose 导致悬空函数指针**：移除 `dlclose(framework)`，DFRFoundation 框架保持加载
- **quit+shutdown 导致 close(channel) panic**：使用 `sync.Once` 保护 Stop/Close/Teardown
- **AdjustUserManual 更新错误用户的状态栏**：改为发送被调整用户的计数
- **CAS 事件队列丢失快速事件**：`__sync_val_compare_and_swap` 改为 `__sync_lock_test_and_set`
- **isDark 不随系统主题变化**：添加 `systemIsDark` state，依赖改为 `[theme, systemIsDark]`
- **删除活跃用户后 UI 不一致**：自动选择剩余用户而非设为 null
- **GetAutoLaunch 默认 true 但未实际启用**：默认值改为 false
- **ParseUserInfoFromLogs 混合不同用户字段**：改为在同一上下文中查找所有字段
- **countUpdated 回调 stale closure**：使用 ref 存储最新引用
- **无 last_active_user 时静默返回 nil**：改为返回明确错误
- **About 面板 License 文字错误**：从 "MIT License" 更正为 "CC BY-NC 4.0"
- **ldflags 版本注入路径错误**：从 `-X main.version` 修正为 `-X trae-counter/internal/version.Version`

### 改进

- **通知分类**：提醒（remind）10 秒后自动消失，警告（alert）常驻 + timeSensitive
- **通知堆叠**：不同类型通知可同时显示，同类型覆盖旧通知
- **历史查询优化**：周/月历史从 N+1 查询改为单条 GROUP BY（37 次 SQL → 2 次）
- **前端防抖**：refreshData 添加 500ms 防抖，手动操作立即触发
- **日志精简**：只在新消息时输出日志，减少日志噪音
- **版权年份**：更新为 2026
- **自动化测试**：新增 27 个测试覆盖 store/counter/traedb 三个核心模块

## v0.2.0

### 新功能

- **实时文件监听**：使用 fsnotify 监听 Trae 数据目录变化，消息数实时更新
- **防抖机制**：文件变化后 500ms 防抖，避免频繁刷新
- **自动发现新 session**：新对话目录创建时自动加入监听
- **轮询降级**：fsnotify 不可用时自动降级为定时轮询

### 改进

- **License 更改**：从 MIT 改为 CC BY-NC 4.0（署名-非商业性使用）
- **README 重写**：添加项目动机说明（Trae 免费版 50 次额度限制）

## v0.1.0

### 新功能

- **macOS 原生通知**：达到提醒/警告阈值时发送 UNUserNotificationCenter 原生通知
- **自定义 About 面板**：用 NSAlert 显示中文版本信息和版权
- **自动跟随系统主题**：明亮/暗黑模式自动切换
- **仅状态栏显示**：隐藏 Dock 图标，仅显示在菜单栏
- **开机自启动**：使用 LSSharedFileList API 实现开机自启
- **窗口大小持久化**：窗口尺寸和位置自动保存恢复
- **Universal 二进制**：同时支持 Intel 和 Apple Silicon
- **ldflags 版本注入**：构建时注入版本号

### 修复

- About 页面无法打开、通知不弹出、Dock 隐藏不持久化
- SVG 图表变形、鼠标悬停偏移、长按误触、阈值检查遗漏

### 清理

- 移除已弃用的增量计数方案和未使用资源文件

## v0.0.5

- 编译为独立 App
- README 添加 macOS 签名绕过说明

## v0.0.1 ~ v0.0.3

- 初始版本：追踪每日 Trae IDE 消息数
- 多用户支持、手动补偿、状态栏图标
- 日/周/月/年历史图表
- 对话流水账（幂等 INSERT OR IGNORE）
- 平滑贝塞尔曲线图表
