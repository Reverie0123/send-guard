/**
 * 网页邮箱的 DOM 描述。拦截逻辑（点发送 / Ctrl+Enter → 检查 → 通过适配层点发送）在 content.ts 的 mailAdapter 里统一实现，
 * 每个邮箱只需说明：正文编辑框、发送按钮、撰写区域、收件人数量。
 * 选择器均在真实页面上核对过（2026-09-26）。
 */

export interface MailSpec {
  /** 正文编辑框 */
  editor: string
  /** 从事件目标找到发送按钮；不是发送按钮返回 null */
  sendButtonFrom(el: Element): HTMLElement | null
  /** 撰写区域内的发送按钮 */
  findSendButton(root: Element): HTMLElement | null
  /** 包含正文、发送按钮和收件人栏的撰写区域 */
  composeRoot(from: Element): Element | null
  /** 收件人数量（收件人 + 抄送 + 密送）；统计不到返回 0。只在本地计数，不上传地址 */
  recipientCount(root: Element): number
}

/** 从 el 向外找第一个同时满足 test 的祖先 */
function closestMatching(el: Element, test: (node: Element) => boolean, limit = 40): Element | null {
  let node: Element | null = el
  for (let i = 0; node && i < limit; i++, node = node.parentElement) if (test(node)) return node
  return null
}

const isSendText = (s: string | null | undefined) => /^\s*(发送|發送|Send)\s*$/i.test(s ?? "")

// ---- QQ 邮箱（新版 wx.mail.qq.com） ----
// 正文：div.xmail-cmp-editor-content[contenteditable]；发送：.mail-compose-header 里文字为「发送」的 .xmail-ui-btn
// 撰写区：.mail-compose-draft；收件人标签：.mail-compose-receivers .xmail-cmp-accounts-editor-account-btn
// （有备注名的联系人标签里显示名字而不是地址，所以按标签个数计数）
const QQ_BUTTON = ".mail-compose-header .xmail-ui-btn"

export const qqMail: MailSpec = {
  editor: '.xmail-cmp-editor-content[contenteditable="true"]',
  sendButtonFrom(el) {
    const btn = el.closest<HTMLElement>(QQ_BUTTON)
    return btn && isSendText(btn.textContent) ? btn : null
  },
  findSendButton(root) {
    return [...root.querySelectorAll<HTMLElement>(QQ_BUTTON)].find(b => isSendText(b.textContent)) ?? null
  },
  composeRoot(from) {
    return from.closest(".mail-compose-draft") ?? closestMatching(from, n => !!n.querySelector(this.editor) && !!this.findSendButton(n))
  },
  recipientCount(root) {
    return root.querySelectorAll(".mail-compose-receivers .xmail-cmp-accounts-editor-account-btn").length
  }
}

// ---- Outlook 网页版（outlook.live.com / outlook.office.com） ----
// 正文：[id^="editorParent_"] 下的 [contenteditable][role=textbox]；发送：title 含「(Ctrl+Enter)」的按钮（主按钮，不含「更多发送选项」）
// 收件人：id 以 _TO / _CC / _BCC 结尾的区域里的 ._EType_RECIPIENT_ENTITY
const OUTLOOK_SEND = 'button[title*="Ctrl+Enter"]'
const OUTLOOK_RCPT = '[id$="_TO"], [id$="_CC"], [id$="_BCC"]'

export const outlook: MailSpec = {
  editor: '[id^="editorParent_"] [contenteditable="true"][role="textbox"]',
  sendButtonFrom(el) {
    const btn = el.closest<HTMLElement>(`${OUTLOOK_SEND}, button`)
    if (!btn) return null
    if (btn.matches(OUTLOOK_SEND)) return btn
    return isSendText(btn.getAttribute("aria-label")) ? btn : null
  },
  findSendButton(root) {
    return root.querySelector<HTMLElement>(OUTLOOK_SEND) ??
      [...root.querySelectorAll<HTMLElement>("button")].find(b => isSendText(b.getAttribute("aria-label"))) ?? null
  },
  composeRoot(from) {
    return closestMatching(from, n => !!n.querySelector(this.editor) && !!this.findSendButton(n) && !!n.querySelector(OUTLOOK_RCPT))
  },
  recipientCount(root) {
    return [...root.querySelectorAll(OUTLOOK_RCPT)]
      .reduce((sum, field) => sum + field.querySelectorAll("._EType_RECIPIENT_ENTITY").length, 0)
  }
}
