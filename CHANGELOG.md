# Changelog

版本号只在根目录 `package.json` 维护，通过 `npm run version:sync` 同步。

## [0.1.1] - 2026-09-25
### Changed
- Discord 发送前拦截在真实网页版（Edge 153）上验证通过，README 标注为已验证（影响范围：extension）

## [0.1.0] - 2026-09-25
### Added
- 首个版本：Chromium 扩展，支持 Gmail / Discord 发送前检查，其他已授权网站支持手动检查（影响范围：extension / core）
- core：Jev 请求封装（已对照 docs.typesafe.ai/api 校对）、存储接口、固定模板生成的风险描述（影响范围：core）
- 可选的实时检查模式，需在弹窗确认草稿会上传后才能开启（影响范围：extension）
- 本地自定义敏感词、敏感字段跳过、结果缓存、请求 ID 竞态保护、API 失败时显示「检查未完成」（影响范围：extension）
- 桌面版占位目录（影响范围：desktop）
