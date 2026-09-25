/** Gmail 撰写窗口的 DOM 适配：选择器、定位撰写区域、统计收件人数量 */

export const GMAIL_EDITOR = 'div[contenteditable="true"][g_editable="true"]'
// 发送按钮 tooltip 形如「发送 (Ctrl-Enter)」/「Send (⌘Enter)」，不依赖界面语言；.T-I.aoO 为兜底
export const GMAIL_SEND = '[role="button"][data-tooltip*="Enter)"], [role="button"][aria-label*="Enter)"], .T-I.aoO'

export function gmailComposeRoot(from: Element): Element | null {
  let node: Element | null = from
  for (let i = 0; node && i < 40; i++, node = node.parentElement) {
    if (node.querySelector(GMAIL_EDITOR) && node.querySelector(GMAIL_SEND)) return node
  }
  return null
}

/**
 * 包含收件人栏的撰写区域。正文和发送按钮的最近公共祖先里往往没有收件人 / 主题栏，
 * 所以从正文往外找第一个包含主题栏（input[name="subjectbox"]）的祖先；
 * 找不到再退回弹出式撰写窗口（role="dialog"），最后才用 gmailComposeRoot。
 * 取「第一个」包含主题栏的祖先，避免把会话里其他邮件的发件人也算进来。
 */
export function gmailRecipientRoot(editor: HTMLElement): Element | null {
  let node: Element | null = editor
  for (let i = 0; node && i < 60; i++, node = node.parentElement) {
    // 已经包住了别的撰写窗口，说明越过了当前这封邮件，不再往外找
    if (node.querySelectorAll(GMAIL_EDITOR).length > 1) break
    if (node.querySelector('input[name="subjectbox"]')) return node
  }
  return editor.closest('[role="dialog"]') ?? gmailComposeRoot(editor)
}

/**
 * 统计撰写窗口里的收件人数量（收件人 + 抄送 + 密送）。
 * 地址只在本地去重计数，不保存、不上传。统计不到时返回 0。
 */
export function gmailRecipientCount(editor: HTMLElement): number {
  const root = gmailRecipientRoot(editor)
  if (!root) return 0
  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  const ids = new Set<string>()
  const add = (v: string | null | undefined) => {
    for (const m of v?.match(EMAIL) ?? []) ids.add(m.toLowerCase())
  }

  // 1. 隐藏的收件人字段
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input[name="to"], input[name="cc"], input[name="bcc"], textarea[name="to"], textarea[name="cc"], textarea[name="bcc"]'
  ).forEach(i => add(i.value))
  // 2. 收件人标签（chip）上的属性
  root.querySelectorAll<HTMLElement>("[data-hovercard-id], [email]").forEach(el => {
    if (!editor.contains(el)) add(el.getAttribute("data-hovercard-id") || el.getAttribute("email"))
  })
  // 3. 收件人栏未聚焦时只显示纯文字地址：扫正文以外的可见文字
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!editor.contains(n)) add(n.nodeValue)
  }

  // 页面标题里有当前登录的账号（「收件箱 - you@gmail.com - Gmail」），发件人地址不算收件人
  for (const self of document.title.match(EMAIL) ?? []) ids.delete(self.toLowerCase())
  return ids.size
}
