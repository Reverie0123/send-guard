/**
 * 已专门适配「发送前拦截」的网站。
 * 新增站点时：content.ts 加适配器 → 这里登记 → README 表格 → CHANGELOG → 升 minor。
 */
export interface SupportedSite {
  id: "gmail" | "discord" | "qqmail" | "outlook" | "x"
  name: string
  hosts: readonly string[]
}

export const SUPPORTED_SITES: readonly SupportedSite[] = [
  { id: "gmail", name: "Gmail", hosts: ["mail.google.com"] },
  { id: "discord", name: "Discord", hosts: ["discord.com"] },
  // mail.qq.com 登录后会跳到新版 wx.mail.qq.com
  { id: "qqmail", name: "QQ 邮箱", hosts: ["wx.mail.qq.com"] },
  // 个人账号 outlook.live.com；工作 / 学校账号 outlook.office.com、outlook.office365.com（同一套网页）
  { id: "outlook", name: "Outlook", hosts: ["outlook.live.com", "outlook.office.com", "outlook.office365.com"] },
  // twitter.com 会跳转到 x.com
  { id: "x", name: "X", hosts: ["x.com"] }
]

export function supportedSiteFor(hostname: string): SupportedSite | undefined {
  return SUPPORTED_SITES.find(s => s.hosts.includes(hostname))
}

/**
 * 自动唤醒：输入框获得焦点时在角上显示检查按钮。
 * 默认值：已专门适配的网站关闭（按发送时本来就会检查），其他已授权网站开启；用户可按网站覆盖。
 */
export function wakeEnabled(overrides: Record<string, boolean> | undefined, hostname: string): boolean {
  return overrides?.[hostname] ?? !supportedSiteFor(hostname)
}

/** 判断一个 URL 是否被某个 match pattern（如 https://*.example.com/*、<all_urls>）覆盖 */
export function patternMatchesUrl(pattern: string, url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (pattern === "<all_urls>") return u.protocol === "http:" || u.protocol === "https:"
  const m = /^(\*|https?):\/\/([^/]+)\//.exec(pattern)
  if (!m) return false
  const [, scheme, host] = m
  if (scheme === "*" ? !["http:", "https:"].includes(u.protocol) : u.protocol !== `${scheme}:`) return false
  if (host === "*") return true
  if (host!.startsWith("*.")) {
    const base = host!.slice(2)
    return u.hostname === base || u.hostname.endsWith(`.${base}`)
  }
  return u.hostname === host
}
