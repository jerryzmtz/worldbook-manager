CLAUDE.md

## 世界书管理器 iOS / TauriTavern 排障经验

- 真实反馈：`v3.24` 已确认在 `iOS + TauriTavern + 无 Agent 模式` 可以正常打开并运行。以后遇到类似黑屏，优先回看这条兼容路径，不要先把问题归因到普通 UI 渲染或按钮注册。
- 根因判断：问题主要来自 iOS WKWebView / TauriTavern 环境里过深的请求捕获 hook。`fetch`、`jQuery.ajax`、`XMLHttpRequest`、Tauri invoke broker、可见流式响应体读取这些深度 hook，在 iOS WebView 里容易和 TT 宿主补丁、预设切换后的函数替换、流式响应生命周期或 ready 时序冲突，表现可能是黑屏、按钮像没加载、重复记录或抓不到记录。桌面浏览器、桌面 TT、ST 正常不能证明 iOS TT 安全。
- 正确修复方向：不要在 iOS TT 上完全禁用 monitor；monitor 是核心功能。应保留面板和记录监听，但默认走 TT 原生日志轻量捕获：使用 `__TAURITAVERN__.api.dev.llmApiLogs` 的订阅 / 索引 / `getRaw` 回填记录，同时跳过浏览器请求 hook 和 Tauri invoke broker hook。
- 不要默认恢复的能力：iOS TT 默认不要读取可见流式响应体，也不要默认重装 fetch/ajax/XHR/invoke 捕获。需要排障时可以做显式开关，但不能作为默认路径发布。
- 验证重点：这类问题的验收标准是“真实 iOS TT 不黑屏 + 两个按钮能打开 + 非 Agent 模式完成回复后能出现缓存命中记录”。“请求中”状态长期不稳定，不应作为判断本次黑屏修复是否成功的核心指标。
- 发布经验：如果用户反馈只在 `iOS + TT + 无 Agent 模式` 出问题，优先做最小风险兼容分支并发小版本让真实设备验证；不要在无法本地复现时反复切换大方向。版本发布仍按 `CLAUDE.md` 里的 `[bot] bundle` / tag / Release 流程执行。
