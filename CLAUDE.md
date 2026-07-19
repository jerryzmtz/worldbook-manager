# 酒馆助手前端界面或脚本编写

@.cursor/rules/项目基本概念.mdc
@.cursor/rules/mcp.mdc
@.cursor/rules/酒馆变量.mdc
@.cursor/rules/酒馆助手接口.mdc
@.cursor/rules/前端界面.mdc
@.cursor/rules/脚本.mdc
@.cursor/rules/mvu变量框架.mdc
@.cursor/rules/mvu角色卡.mdc
<<<<<<< HEAD

## 项目参考资料

- [MoeBlack：DeepSeek v4 缓存与首个 User 策略](参考资料/MoeBlack_DeepSeek-v4-缓存与首个-User-策略.md)：用户提供的社区讨论整理，用于指导“世界书管理器”将世界书、角色设定、输出示例和输出引导组织进首个 `User` 消息，以最大化 DeepSeek v4 f/p 缓存命中并保留首个 `User` 末尾控制指令的设计空间。
- [yhny：DeepSeek v4 严格前缀缓存与消息重组策略](参考资料/yhny_DeepSeek-v4-严格前缀缓存与消息重组策略.md)：用户提供的社区讨论整理，用于指导“世界书管理器”生成稳定、可复现的固定前缀块，并理解通过酒馆助手脚本重组 `messages` 数组来提高 DeepSeek v4 缓存命中的方案。
- [Aimyon：提高 DS 缓存命中率省钱方案](参考资料/脑测一些提高DS缓存命中率省钱的方案.md)：用户提供的社区讨论整理，用于指导“世界书管理器”避免 D1-D9998 中间深度、细分稳定宏与动态宏、提示摘要/变量/MVU 等动态内容的缓存风险，并设计自动备份基线过期检测。

## 发布流程（世界书管理器）

- 不要使用自动推导版本号的 GitHub Actions 自动打标；版本号以 `src/世界书管理器/App.vue` 的 `APP_VERSION` 为准。
- 发布时先把 `APP_VERSION` 改为目标 tag（例如 `v3.10`），完成验证后执行 `I:\SillyTavern_Helper\一键更新世界书管理器.bat` 推送源码并等待 `[bot] bundle`。
- 更新云端必须使用 `I:\SillyTavern_Helper\一键更新世界书管理器.bat`，不要手动 `git push` 到远端。
- 目标 tag 和 GitHub Release 必须指向 `[bot] bundle` commit；不要把 tag 指到源码提交，也不要留下 `v0.0.x` 这类自动生成 tag。
- 发布后确认 `releases/latest` 返回目标版本，并确认目标 tag 下存在 `dist/世界书管理器/index.js`。
=======
>>>>>>> a4d60f52b8b1b0f872a80088ba7e339b0933eeb2
