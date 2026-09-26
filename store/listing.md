# 商店上架材料（Microsoft Edge 加载项 / Chrome 应用商店）

提交时按下面各节复制粘贴。上传包用 `npm run package` 生成的 `release-artifacts/send-guard-v{版本}.zip`。

## 基本信息

- **名称**：Send Guard
- **类别**：生产力工具（Productivity）
- **语言**：扩展包自 v0.3.2 起带 `_locales/en` 与 `_locales/zh_CN`，商店后台可分别填写英文和中文（简体）介绍；界面文字跟随浏览器语言
- **隐私政策网址**：https://reverie0123.github.io/send-guard/privacy.html
- **网站**：https://reverie0123.github.io/send-guard/
- **在线试玩**：https://reverie0123.github.io/send-guard/demo/
- **商店页面**：https://microsoftedge.microsoft.com/addons/detail/jjcpkbijejeobllcnhkafbmfhdfepbkh（2026-09-26 v0.3.1 上架）
- **支持网址**：https://github.com/Reverie0123/send-guard/issues

## 简短说明（≤ 132 字符）

中文：
> 发送前的隐私检查：判断消息是否透露他人隐私、能否认出具体的人，只在值得复核时提醒，不阻止发送。

English:
> A privacy check before you hit Send: flags messages that may expose someone else's private info. Warns, never blocks.

## 详细说明

中文：

```
Send Guard 在你按下发送键之前做一次隐私检查。

很多隐私泄露不是故意的：在群里随口一句「小李住院了」「老王被裁了」，就把别人不愿公开的事告诉了一群人。Send Guard 会在发送前判断：
• 这条消息是否透露了别人的私事；
• 收件人能否据此认出或找到具体的人；
• 涉及哪类敏感信息（健康、财务、感情、位置、职业）；
• 发到群里还是私聊，风险是否超出了应有的范围。

只在值得复核时弹出提醒，你可以「仍然发送」或「我再看看」，它从不阻止你发送。

支持的网站
• Gmail、Outlook、QQ 邮箱、Discord：按发送时自动检查（均已在真实网页验证）
• 其他网站：授权后可手动检查当前输入框

隐私设计
• 没有自己的服务器，不收集任何数据
• 默认只在按发送时检查；客套话、不涉及他人的短句在本地放行，不上传
• 自定义敏感词只在本地匹配
• 不读取收件人的名字、邮箱、用户名；只可选地使用「私聊 / 群聊 + 人数区间」
• API key 只保存在本机，网页拿不到
• 检查失败显示「检查未完成」，绝不误报为安全

检测服务
使用你自己的 API key：DeepSeek（推荐）、TypeSafe Jev 或 OpenRouter。

开源：https://github.com/Reverie0123/send-guard
```

English:

```
Send Guard runs a privacy check right before you send a message.

Many privacy leaks are accidental — a casual "Li is in the hospital" in a group chat tells everyone something that wasn't yours to share. Before sending, Send Guard estimates whether the message reveals someone else's private information, whether the recipients could identify that person, which sensitive category is involved, and whether a group audience makes it riskier.

It only warns when a second look is worthwhile. You can always "Send anyway" — it never blocks you.

• Gmail, Outlook, QQ Mail and Discord: automatic check on Send (verified on the live sites)
• Other sites: manual check after you grant access
• No server of its own; collects no data
• Short trivial messages and custom sensitive words are handled locally, never uploaded
• Never reads recipient names, emails or usernames
• API keys stay on your device; failures show "check incomplete", never "safe"

Bring your own API key: DeepSeek (recommended), TypeSafe Jev or OpenRouter.
Open source: https://github.com/Reverie0123/send-guard
```

## 单一用途说明（Chrome 要求）

> 在用户发送消息前检查消息内容是否可能泄露第三方隐私，并在需要复核时提醒用户。
>
> Check messages for possible third-party privacy disclosure right before the user sends them, and warn when a review is worthwhile.

## 权限用途说明

| 权限 | 用途 |
|------|------|
| `storage` | 保存用户设置、各检测服务的 API key 和每月统计（检查次数、token 数）。不保存消息内容。 |
| `activeTab` | 用户在弹窗中点击「检查当前输入框」时，访问当前标签页的输入框内容。 |
| `scripting` | 在用户授权的网站上注册 / 注入检查脚本；撤销授权后注销。 |
| 主机权限 `https://api.typesafe.ai/*`、`https://api.deepseek.com/*`、`https://openrouter.ai/*` | 向用户选择的检测服务发送检查请求。 |
| 可选主机权限 `<all_urls>` | 仅在用户对某个网站点击「在此网站启用」并在浏览器授权框中同意后，才在该网站运行。不会自动申请。 |

- **是否使用远程代码**：否。所有代码都打包在扩展内。
- **数据使用披露（Chrome 隐私权规范表单）**：勾选「网站内容」（消息文字，仅在检查时发送给用户选择的检测服务）；其余类别均不收集。数据不出售、不用于与单一用途无关的目的、不用于信用评估。

## 截图

`store/screenshots/` 下的 PNG（1280×800）：

1. `01-warning.png`：Discord 群聊里发送前弹出的提醒面板
2. `02-gmail.png`：Gmail 发送前检查
3. `03-popup.png`：设置弹窗（检测服务、发送对象识别、自定义敏感词）

截图由 `store/screenshots/*.html` 生成，内容为示例数据，不含真实用户信息。

## 商店图标与宣传图

- `store/screenshots/logo-300.png`：商店图标（300×300，Edge 必填）
- `store/screenshots/promo-440x280.png`：小宣传图（440×280，可选）

均由 `npm run store:screenshots` 生成。

## 给审核员的测试说明（Notes for certification）

```
Send Guard checks a message for third-party privacy disclosure right before it is sent. It uses the reviewer's/user's own API key; no account or server of ours is involved.

How to test without an API key (recommended for review):
1. Open https://discord.com or https://mail.google.com, click the extension icon, then "在此网站启用" (Enable on this site) and allow the permission prompt.
2. Type a message of 20+ characters and press Enter (Discord) or Send / Ctrl+Enter (Gmail).
3. Sending is paused and a panel appears. Without an API key it shows "? 检查未完成" (check incomplete) — by design, a failed check is never shown as "safe". Click "仍然发送" (Send anyway) to send, or "我再看看" (Let me review) to cancel.
4. Local-only feature (no key needed): in the popup, enter a word under "自定义敏感词" (custom sensitive words), e.g. "secret". Typing a message containing it and pressing Send shows a red panel; nothing is uploaded.

Optional, with a key: choose "DeepSeek" in the popup, paste a DeepSeek API key (platform.deepseek.com), click "保存并测试连接". A message like "Li in our class failed three exams and may be expelled" sent in a server channel then shows risk scores.

Permissions: host access to other sites is optional and only requested when the user clicks "Enable on this site". api.typesafe.ai / api.deepseek.com / openrouter.ai are the detection services the user can choose. No remote code.
Privacy policy: https://reverie0123.github.io/send-guard/privacy.html
```

## 提交前自查

- [ ] `npm test` 通过，`npm run calibrate` 无漏报 / 误报
- [ ] zip 包里的 manifest 版本号与 CHANGELOG 一致
- [ ] 隐私政策页可以打开
- [ ] 在全新浏览器配置里加载 zip，确认弹窗、授权、拦截流程正常
