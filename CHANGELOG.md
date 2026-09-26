# Changelog

版本号只在根目录 `package.json` 维护，通过 `npm run version:sync` 同步。

## [0.4.3] - 2026-09-26
### Changed
- Send Guard 已在 Microsoft Edge 加载项商店上架（v0.3.1）；README、介绍页、试玩页的安装入口改为商店链接（影响范围：extension）
### Fixed
- 试玩页的示例结果被浏览器缓存 10 分钟，重新生成后访客仍看到旧结果；改为每次向服务器确认（影响范围：extension）

## [0.4.2] - 2026-09-26
### Fixed
- 群聊反讽漏报：Discord 服务器频道这类「人数未知的群」原先描述为 an unknown number of people，模型低估了受众，「咱们班那位'学霸'终于不用补考了」在频道里直接放行（复核建议 1.8）。改为 possibly many people，并在通用模型说明中补充「在群里以玩笑或祝贺的口吻暗示他人的不体面私事也需要复核」；89 条样本回归：该提醒 42/42、误报 0/36（影响范围：core）
- 在线试玩页的示例结果按新规则重新生成（影响范围：extension）

## [0.4.1] - 2026-09-26
### Added
- 在线试玩页 docs/demo/：模拟 Gmail 与 Discord，运行真实的 content.ts，示例消息结果由 DeepSeek 预先生成，不用安装、不用 API key，中英文可切换（影响范围：extension）
- GitHub Release 附带可直接安装的 zip 与安装说明；README 增加试玩与下载入口（影响范围：extension）

## [0.4.0] - 2026-09-26
### Added
- 新增 QQ 邮箱（wx.mail.qq.com）和 Outlook（outlook.live.com，含 outlook.office.com）的发送前拦截：发送按钮 / Ctrl+Enter，放行时通过适配层点发送；按收件人标签数识别发送对象。两者均在真实页面验证（影响范围：extension）
- 网页邮箱适配抽成通用的 mailAdapter + MailSpec（mail-sites.ts），新增邮箱只需描述选择器（影响范围：extension）
### Changed
- TypeSafe 暂停新账号注册，新安装默认使用 DeepSeek；弹窗中 Jev 标注「暂停新注册」、DeepSeek 标为推荐；已选过服务的用户不受影响（影响范围：extension）
- 支持的网站可登记多个域名（Outlook 个人 / 工作账号）（影响范围：extension）
### Fixed
- 撰写窗口被关闭或隐藏后，提示图标仍悬浮在页面上：改为每秒检查挂靠的输入框，消失即收起（影响范围：extension）

## [0.3.2] - 2026-09-26
### Added
- 中英文界面：弹窗、提醒面板、风险描述和连接测试提示跟随浏览器语言，中文浏览器显示中文，其余显示英文；core 文案函数新增 locale 参数，桌面版可复用（影响范围：extension / core）
- 扩展包加入 `_locales/en`、`_locales/zh_CN`，manifest 名称与简介改为多语言，商店可添加中文介绍（影响范围：extension）
- 商店图标（300×300）与小宣传图（440×280）、审核员测试说明，截图脚本一并生成（影响范围：extension）
### Fixed
- 实时模式确认文字仍写「上传至 TypeSafe API」，改为「上传至所选的检测服务」（影响范围：extension）

## [0.3.1] - 2026-09-26
### Fixed
- Gmail 发送对象识别在真实页面上显示「未识别」：收件人栏不在正文和发送按钮的公共区域内，且未聚焦时只显示纯文字地址。改为从正文向外找到包含主题栏的撰写区域，并同时读取隐藏字段、收件人标签和纯文字地址；越过当前撰写窗口时停止，不把会话里其他人算进来；自己的账号不计入（影响范围：extension）
### Changed
- Gmail 选择器与收件人计数拆到单独的 gmail.ts（影响范围：extension）

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
