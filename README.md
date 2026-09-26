# Send Guard

**当前版本：v0.4.1** · [更新日志](CHANGELOG.md) · **[在线试玩](https://reverie0123.github.io/send-guard/demo/)** · [下载](https://github.com/Reverie0123/send-guard/releases/latest)

> 在线试玩不用安装、不用 API key：页面运行的是真实的扩展代码，示例消息的结果由 DeepSeek 预先生成。

Send Guard 在你按下发送键之前做一次隐私检查：结合消息内容、收件人关系和你提供的少量上下文，判断是否涉及第三方隐私、能否据此认出具体的人、是否超出应有的披露范围。它不会阻止你发送，只在值得再看一眼时提醒。

## 支持网站

| 网站 | 支持方式 | 状态 |
|------|---------|------|
| Gmail（mail.google.com） | 发送前拦截：发送按钮 / Ctrl(⌘)+Enter | 已验证（Edge 153，2026-09-25） |
| Discord（discord.com） | 发送前拦截：Enter | 已验证（Edge 153，2026-09-25） |
| QQ 邮箱（wx.mail.qq.com） | 发送前拦截：发送按钮 / Ctrl+Enter | 已验证（Edge 153，2026-09-26） |
| Outlook（outlook.live.com） | 发送前拦截：发送按钮 / Ctrl+Enter | 已验证（Edge 153，2026-09-26）；工作 / 学校账号的 outlook.office.com 为同一套网页，未单独验证 |
| 其他已授权网站 | 手动检查：点扩展图标 →「检查当前输入框」 | — |

**不支持**在所有网站上做发送前拦截。每个网站的发送按钮、Enter 逻辑和表单结构都不一样，只有专门适配过的网站才会拦截。

## 安装

**直接安装**：在 [Releases](https://github.com/Reverie0123/send-guard/releases/latest) 下载 `send-guard-v版本号.zip` 并解压，按下面 Chrome / Edge 的步骤选择解压后的文件夹。

**从源码构建**（需要 Node.js 18+）：

```bash
npm install
npm run build
```

构建产物在 `packages/extension/dist/`。

**Chrome**
1. 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择 `packages/extension/dist`

**Edge**
1. 打开 `edge://extensions`
2. 左下角打开「开发人员模式」
3. 点「加载解压缩的扩展」，选择 `packages/extension/dist`

### 检测服务

在扩展弹窗的「检测服务」里选择，各服务的 key 分开保存：

| 服务 | 说明 |
|------|------|
| DeepSeek（默认，推荐） | 调用 DeepSeek 官方 API（默认模型 `deepseek-flash`），判定阈值已用中文样本校准。key 在 [platform.deepseek.com](https://platform.deepseek.com/api_keys) 获取 |
| TypeSafe Jev | 返回经过校准的概率，是本项目最初设计的检测服务。**TypeSafe 目前暂停了新账号注册**，已有 key 可以直接使用 |
| OpenRouter（备选） | 经 OpenRouter 调用任意模型（默认 `deepseek/deepseek-v4.1-flash`），只路由到不留存数据的服务商 |

DeepSeek 和 OpenRouter 用同一组问题让通用大模型打分，**给出的概率未经校准**，面板上会注明「仅供参考」。风险描述文字仍由固定模板生成，不让模型写解释。没有 key 或检查失败时显示「检查未完成」，不会显示为安全；自定义敏感词的本地匹配始终可用。

### 检测条件

1. **本地预筛（不上传）**：密码 / 信用卡 / 登录表单字段跳过；命中自定义敏感词直接提示；客套短回复（好的、收到、哈哈…）放行；不到 20 字的短句只有出现指人的词（朋友、同事、同桌、小李…）、敏感事件词（确诊、离婚、欠钱、被打…）或像号码的数字时才上传检查。
2. **发送对象（可关闭）**：Discord 按网址区分服务器频道 / 私信，Gmail 统计收件人数量（含抄送），只把「私聊 / 群聊 + 人数区间」一起发给检测服务，不读取也不上传任何名字、邮箱、用户名。同一句「你欠我的两千块什么时候还」，私聊不提醒、发在群里会提醒。
3. **模型打分**：第三方隐私、身份可链接（0–1）、敏感类别、复核建议（0–3）。
4. **判定**：
   - TypeSafe Jev：第三方隐私 ≥ 0.8、身份可链接 ≥ 0.75、有敏感类别且复核建议 ≥ 1.5、复核建议 ≥ 2.4 任一满足即提醒；（第三方隐私 ≥ 0.85 且身份可链接 ≥ 0.8）或复核建议 ≥ 2.8 为红色。
   - DeepSeek / OpenRouter：只看复核建议，≥ 2.1 提醒，≥ 2.8（或 ≥ 2.1 且第三方隐私、身份可链接都很高）为红色。通用模型提到任何人都会给高的第三方隐私分，单独用它会大量误报；该阈值用 78 条中文样本校准（2026-09-25，deepseek-flash）：该提醒 34/34 全部提醒，不该提醒 34 条 0 误报。

安装后：
1. 点扩展图标，在「检测服务」里选择服务并填入对应的 API key，点「保存并测试连接」。
2. 打开 Gmail 或 Discord，点扩展图标 →「在此网站启用」，在浏览器弹出的授权框里允许。
3. 在弹窗中移除网站，或在浏览器扩展设置里撤销网站权限，都会立即停止在该网站工作。

界面语言跟随浏览器：中文浏览器显示中文，其他语言显示英文。

## 隐私说明

- **默认只在点击发送时上传**：在已支持的网站上，只有按下发送时才会把内容发到你选择的检测服务（TypeSafe / DeepSeek / OpenRouter），不会发到其他地方。少于 20 字、密码 / 信用卡字段、登录表单一律不上传。
- **自定义敏感词只在本地匹配**：命中时直接提示，不发任何请求。
- **API key 只存在本地**：保存在浏览器的扩展存储里，只由后台脚本读取，网页和页面脚本都拿不到。
- **不记录任何内容**：不保存消息原文，不写日志。每月统计只记录检查次数和 token 数量。
- **不上传收件人身份**：不读取也不上传收件人的名字、邮箱或用户名。默认会附带「私聊 / 群聊 + 人数区间」帮助判断，可在弹窗中关闭。
- **实时模式需要手动开启**：开启前必须确认「未发送的草稿会在输入停止时上传」。
- **选择 DeepSeek / OpenRouter 时**：消息会发给对应服务商，并适用其隐私政策；弹窗里会标明内容发往哪里。
- **检查失败不会显示为安全**：API 出错时显示灰色 `?`「检查未完成」，不会显示成低风险。

## 桌面版计划

`packages/desktop`：基于 Electron 的桌面悬浮窗，用快捷键触发检查，覆盖微信 PC 版、QQ 等桌面聊天软件。与扩展共用 `packages/core`，计划从 v0.4.0 开始。

## 移动端计划

iOS Safari 扩展，计划中。

## 开发

| 命令 | 作用 |
|------|------|
| `npm run build` | 构建扩展到 `packages/extension/dist` |
| `npm test` | 本地单元测试（不联网），发布流程会自动运行 |
| `npm run calibrate` | 用真实接口跑 `tests/calibration/cases.json` 的校准样本，统计漏报 / 误报（需环境变量 `DEEPSEEK_API_KEY`，一轮约 ¥0.1） |
| `npm run package` | 生成上架用的 `release-artifacts/send-guard-v{版本}.zip` |
| `npm run store:screenshots` | 重新生成商店截图 `store/screenshots/*.png` |
| `npm run build:demo` | 用真实的 content.ts 构建在线试玩脚本 `docs/demo/content-*.js` |
| `npm run demo:results` | 重新生成试玩页的示例结果（需 `DEEPSEEK_API_KEY`） |
| `npm run release` | 同步版本号 → 编译检查 → 单元测试 → 提交、打 tag、推送 |

商店上架文案、权限说明见 [store/listing.md](store/listing.md)，隐私政策见 [docs/privacy.html](https://reverie0123.github.io/send-guard/privacy.html)。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
