# Changelog

版本号只在根目录 `package.json` 维护，通过 `npm run version:sync` 同步。

## [0.3.0] - 2026-09-25
### Added
- 自动识别发送对象：Discord 区分服务器频道 / 私信，Gmail 统计收件人数量；只上传「私聊 / 群聊 + 人数区间」，不读取名字和地址；面板显示识别结果，弹窗可关闭（影响范围：extension / core）
- 测试进仓库：`npm test` 单元测试（22 项，发布流程自动运行，不过就不推送）；`npm run calibrate` 用 89 条中文样本跑真实接口统计漏报 / 误报（影响范围：core）
- 上架材料：GitHub Pages 隐私政策与介绍页（docs/）、商店文案与权限说明（store/listing.md）、截图生成脚本、`npm run package` 打包 zip（影响范围：extension）
### Changed
- 发布脚本推送失败时自动重试一次，仍失败则报错退出（影响范围：extension / core）
- 桌面版计划顺延至 v0.4.0（影响范围：desktop）

## [0.2.1] - 2026-09-25
### Fixed
- 不到 20 字的短句不再一律放行：改为本地判断是否涉及他人 / 敏感事件 / 号码，涉及则上传检查（如「我朋友小李今天在学校被打了」）（影响范围：core / extension）
### Changed
- DeepSeek / OpenRouter 结果改用单独阈值：只按复核建议 ≥ 2.1 提醒，消除「提到别人就提醒」的误报；用 78 条中文样本校准（影响范围：core）
- 通用模型提示词补充反讽、阴阳怪气、代称（「某些人」「那位'学霸'」）的判断说明，并区分群聊与私聊当事人；25 条回归样本全部判对（影响范围：core）

## [0.2.0] - 2026-09-25
### Added
- 新增 DeepSeek / OpenRouter 检测服务作为 Jev 的临时替代，弹窗可切换，各服务 key 分开保存（影响范围：extension / core）
- core 新增 OpenAI 兼容后端 llm.ts，复用 Jev 的同一组问题和判定阈值；非 Jev 结果在面板注明「概率未经校准」（影响范围：core / extension）
- 统计分服务显示费用：OpenRouter 显示实际费用，DeepSeek 按官方高峰价估算（影响范围：extension）

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
