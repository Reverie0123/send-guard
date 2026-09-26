# Send Guard Desktop（计划中）

基于 Electron 的桌面悬浮窗。**计划中，尚未开始实现**，将在浏览器扩展稳定后启动。

- 目标：覆盖微信 PC 版、QQ 等没有浏览器扩展入口的桌面聊天软件
- 触发：全局快捷键 → 读取剪贴板或悬浮窗里粘贴的待发送内容 → 显示与扩展相同的风险面板
- 复用：业务逻辑全部来自 `packages/core`（`analyze()`、`getRiskSummary()` 等），不重复实现
- 存储：用 `electron-store` 实现 `core` 的 `StorageAdapter` 接口
- API key：只在主进程读取，渲染进程拿不到，和扩展里只由 background 读取的做法一致

当前目录只是占位，不参与构建。
