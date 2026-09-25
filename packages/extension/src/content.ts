import {
  BAND_COLORS,
  categoryLabel,
  getAlertLevel,
  getRiskSummary,
  localGate,
  MAX_TEXT_LENGTH,
  providerNote,
  riskBand,
  type JevResultPublic
} from "@send-guard/core"
import type { AnalyzeResponse, ConfigResponse, ContentConfig, ContentPush, ManualCheckResponse } from "./messages"
import { patternMatchesUrl, supportedSiteFor } from "./sites"

// =====================================================================
// 生命周期：防重复注入；扩展重载 / 权限撤销时彻底卸载
// =====================================================================

type GlobalWithGuard = typeof globalThis & { __sendGuardTeardown?: () => void }
const g = globalThis as GlobalWithGuard
g.__sendGuardTeardown?.()

const disposers: Array<() => void> = []
let alive = true

function on<K extends string>(
  target: EventTarget,
  type: K,
  handler: (e: Event) => void,
  capture = true
): void {
  target.addEventListener(type, handler, capture)
  disposers.push(() => target.removeEventListener(type, handler, capture))
}

function teardown(): void {
  if (!alive) return
  alive = false
  cancelCurrent()
  clearTimeout(realtimeTimer)
  for (const d of disposers.splice(0)) d()
  ui.destroy()
  if (g.__sendGuardTeardown === teardown) delete g.__sendGuardTeardown
}
g.__sendGuardTeardown = teardown

function runtimeOk(): boolean {
  try {
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}

// =====================================================================
// 配置（从 background 获取，content 不读 storage，不接触 API key）
// =====================================================================

let config: ContentConfig | null = null

async function refreshConfig(): Promise<void> {
  if (!runtimeOk()) return teardown()
  try {
    const r = (await chrome.runtime.sendMessage({ type: "getConfig" })) as ConfigResponse | undefined
    if (!r) return
    if (!r.allowed) return teardown()
    applyConfig(r.config)
  } catch {
    if (!runtimeOk()) teardown()
  }
}

function applyConfig(c: ContentConfig): void {
  const rulesChanged = config?.rulesVersion !== c.rulesVersion
  config = c
  if (rulesChanged) cache.clear()
  if (!c.enabled) {
    cancelCurrent()
    ui.hideAll()
  }
}

// =====================================================================
// 输入框识别与本地过滤
// =====================================================================

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", ""])

function eventTarget(e: Event): Element | null {
  const t = e.composedPath()[0] ?? e.target
  return t instanceof Element ? t : null
}

function editableFrom(t: Element | null): HTMLElement | null {
  if (!t) return null
  if (t instanceof HTMLTextAreaElement) return t
  if (t instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(t.type) ? t : null
  return t.closest<HTMLElement>('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')
}

function readText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return el.innerText
}

/** 密码框、信用卡字段、登录表单一律不处理。必须在 20 字符过滤之前执行。 */
function isSensitiveField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === "password") return true
  const ac = (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/)
  if (ac.some(t => t.startsWith("cc-") || t === "current-password" || t === "new-password" || t === "one-time-code")) return true
  const form = el.closest("form")
  if (form?.querySelector('input[type="password"]')) return true
  return false
}

function matchSensitiveWords(text: string): string[] {
  if (!config) return []
  const lower = text.toLowerCase()
  return config.sensitiveWords.filter(w => lower.includes(w.toLowerCase()))
}

// =====================================================================
// 缓存：key = hash(text) + recipientContext + rulesVersion
// =====================================================================

const CACHE_LIMIT = 100
const cache = new Map<string, JevResultPublic>()

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("")
}

function cachePut(key: string, value: JevResultPublic): void {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}

// =====================================================================
// 请求 ID 与竞态保护
// =====================================================================

let currentRequestId: string | null = null

function cancelCurrent(): void {
  if (!currentRequestId) return
  const id = currentRequestId
  currentRequestId = null
  if (runtimeOk()) chrome.runtime.sendMessage({ type: "cancel", requestId: id }).catch(() => {})
}

type Outcome =
  | { kind: "pass"; reason: "short" | "sensitive-field" | "empty" }
  | { kind: "words"; words: string[] }
  | { kind: "result"; result: JevResultPublic; truncated: boolean }
  | { kind: "error"; reason: "no-key" | "failed" }

/** 返回 null 表示结果已过期（有更新的检查在进行），调用方什么都不要做 */
async function requestAnalysis(text: string): Promise<Outcome | null> {
  cancelCurrent()
  const requestId = crypto.randomUUID()
  currentRequestId = requestId

  let resp: AnalyzeResponse | undefined
  try {
    resp = (await chrome.runtime.sendMessage({ type: "analyze", requestId, text })) as AnalyzeResponse | undefined
  } catch {
    resp = undefined
  }

  if (currentRequestId !== requestId) return null // 过期响应直接丢弃
  currentRequestId = null

  if (!resp || resp.requestId !== requestId) return { kind: "error", reason: "failed" }
  if ("ok" in resp) return { kind: "result", result: resp.result, truncated: text.length > MAX_TEXT_LENGTH }
  if (resp.reason === "revoked") {
    teardown()
    return null
  }
  if (resp.reason === "cancelled") return null
  return { kind: "error", reason: resp.reason === "no-key" ? "no-key" : "failed" }
}

let checkSeq = 0

/** 完整检查流程：敏感字段 → 自定义敏感词 → 本地预筛 → 缓存 → 请求 */
async function check(el: HTMLElement): Promise<Outcome | null> {
  const seq = ++checkSeq
  if (isSensitiveField(el)) return { kind: "pass", reason: "sensitive-field" }

  const text = readText(el).trim()
  if (!text) return { kind: "pass", reason: "empty" }

  const words = matchSensitiveWords(text)
  if (words.length) return { kind: "words", words } // 本地命中，不发任何请求

  // 客套短回复、不涉及他人的短句不上传；≥20 字或短句里出现指人 / 敏感事件 / 号码才检查
  const gate = localGate(text)
  if (!gate.check) return { kind: "pass", reason: "short" }

  const key = `${await sha256(text)}|${config?.recipientContext ?? ""}|${config?.rulesVersion ?? 0}`
  if (seq !== checkSeq) return null
  const hit = cache.get(key)
  if (hit) return { kind: "result", result: hit, truncated: text.length > MAX_TEXT_LENGTH }

  const outcome = await requestAnalysis(text)
  if (outcome?.kind === "result") cachePut(key, outcome.result)
  if (seq !== checkSeq) return null
  return outcome
}

type IconState = "loading" | "warn" | "red" | "error"

function iconStateOf(o: Outcome): IconState | null {
  switch (o.kind) {
    case "pass":
      return null
    case "words":
      return "red"
    case "error":
      return "error"
    case "result": {
      const level = getAlertLevel(o.result)
      return level === "none" ? null : level
    }
  }
}

// =====================================================================
// UI：Shadow DOM 图标 + 详情面板
// =====================================================================

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.icon {
  position: fixed; z-index: 2147483647; width: 24px; height: 24px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; font-size: 13px; line-height: 1;
  cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.25); background: #fff; border: 2px solid #cbd5e0;
  user-select: none;
}
.icon.loading { cursor: default; animation: pulse 1s ease-in-out infinite; }
.icon.warn { border-color: #dd6b20; background: #fffaf0; }
.icon.red { border-color: #e53e3e; background: #fff5f5; }
.icon.error { border-color: #a0aec0; background: #edf2f7; color: #4a5568; font-weight: 700; }
@keyframes pulse { 50% { opacity: .5; } }
.panel {
  position: fixed; z-index: 2147483647; width: 288px; background: #fff; color: #1a202c;
  border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.22); border: 1px solid #e2e8f0;
  font-size: 13px; overflow: hidden;
}
.head { padding: 10px 14px; font-weight: 600; font-size: 14px; border-bottom: 1px solid #edf2f7; }
.head.warn { background: #fffaf0; color: #9c4221; }
.head.red { background: #fff5f5; color: #9b2c2c; }
.head.error { background: #edf2f7; color: #4a5568; }
.head.none { background: #f7fafc; color: #2d3748; }
.rows { padding: 8px 14px; border-bottom: 1px solid #edf2f7; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; }
.row .label { color: #4a5568; }
.row .val { display: flex; gap: 8px; align-items: center; font-variant-numeric: tabular-nums; }
.band { font-weight: 700; font-size: 11px; }
.bar { display: inline-flex; gap: 2px; }
.bar i { display: block; width: 14px; height: 8px; border-radius: 2px; background: #e2e8f0; }
.summary { padding: 10px 14px; line-height: 1.55; border-bottom: 1px solid #edf2f7; }
.note { padding: 0 14px 8px; color: #718096; font-size: 12px; }
.actions { display: flex; gap: 8px; padding: 10px 14px; justify-content: flex-end; }
button { font: inherit; font-size: 13px; padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid #cbd5e0; background: #fff; color: #2d3748; }
button.primary { background: #2b6cb0; border-color: #2b6cb0; color: #fff; }
button:hover { filter: brightness(.95); }
`

type PanelMode = { kind: "presend"; onSend: () => void; onBack: () => void } | { kind: "info" }

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; style?: string; title?: string } = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props.class) el.className = props.class
  if (props.text !== undefined) el.textContent = props.text
  if (props.style) el.setAttribute("style", props.style)
  if (props.title) el.title = props.title
  el.append(...children)
  return el
}

class Ui {
  private host: HTMLElement | null = null
  private root: ShadowRoot | null = null
  private icon: HTMLElement | null = null
  private panel: HTMLElement | null = null
  private anchor: HTMLElement | null = null
  private lastOutcome: Outcome | null = null
  private lastMode: PanelMode = { kind: "info" }
  private raf = 0

  get anchorEl(): HTMLElement | null {
    return this.anchor
  }

  private ensureRoot(): ShadowRoot {
    if (this.root && this.host?.isConnected) return this.root
    this.host = document.createElement("send-guard-ui")
    this.root = this.host.attachShadow({ mode: "closed" })
    this.root.append(h("style", { text: STYLE }))
    document.documentElement.append(this.host)
    return this.root
  }

  containsEvent(e: Event): boolean {
    return !!this.host && e.composedPath().includes(this.host)
  }

  showIcon(anchor: HTMLElement, state: IconState): void {
    const root = this.ensureRoot()
    this.anchor = anchor
    if (!this.icon) {
      this.icon = h("div", { class: "icon" })
      this.icon.addEventListener("click", () => {
        if (this.panel) this.hidePanel()
        else if (this.lastOutcome && this.anchor) this.showPanel(this.anchor, this.lastOutcome, this.lastMode)
      })
      root.append(this.icon)
    }
    this.icon.className = `icon ${state}`
    this.icon.textContent = { loading: "🔍", warn: "⚠️", red: "🔴", error: "?" }[state]
    this.icon.title = {
      loading: "Send Guard 检测中…",
      warn: "发送前注意，点击查看",
      red: "高风险，点击查看",
      error: "检查未完成，请确认 API key"
    }[state]
    this.reposition()
  }

  hideIcon(): void {
    this.icon?.remove()
    this.icon = null
  }

  showPanel(anchor: HTMLElement, outcome: Outcome, mode: PanelMode): void {
    const root = this.ensureRoot()
    this.hidePanel()
    this.anchor = anchor
    this.lastOutcome = outcome
    this.lastMode = mode
    this.panel = buildPanel(outcome, mode)
    root.append(this.panel)
    this.reposition()
  }

  /** 记录结果供点击图标时展开，不立即显示面板 */
  setOutcome(outcome: Outcome, mode: PanelMode): void {
    this.lastOutcome = outcome
    this.lastMode = mode
  }

  hidePanel(): void {
    this.panel?.remove()
    this.panel = null
  }

  get panelOpen(): boolean {
    return !!this.panel
  }

  hideAll(): void {
    this.hidePanel()
    this.hideIcon()
    this.anchor = null
    this.lastOutcome = null
  }

  scheduleReposition(): void {
    if (this.raf || (!this.icon && !this.panel)) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.reposition()
    })
  }

  private reposition(): void {
    if (!this.anchor) return
    if (!this.anchor.isConnected) return this.hideAll()
    const r = this.anchor.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const iconLeft = Math.min(Math.max(r.right - 30, 4), vw - 28)
    const iconTop = Math.min(Math.max(r.top + 4, 4), vh - 28)
    if (this.icon) {
      this.icon.style.left = `${iconLeft}px`
      this.icon.style.top = `${iconTop}px`
    }
    if (this.panel) {
      const pw = 288
      const ph = this.panel.offsetHeight || 260
      const left = Math.min(Math.max(iconLeft + 24 - pw, 8), vw - pw - 8)
      const below = iconTop + 30
      const top = below + ph <= vh - 8 ? below : Math.max(8, iconTop - ph - 6)
      this.panel.style.left = `${left}px`
      this.panel.style.top = `${top}px`
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.host?.remove()
    this.host = this.root = this.icon = this.panel = this.anchor = null
  }
}

function bar(score: number): HTMLElement {
  const wrap = h("span", { class: "bar" })
  for (let i = 0; i < 3; i++) {
    const fill = Math.min(Math.max(score - i, 0), 1) * 100
    wrap.append(h("i", { style: `background: linear-gradient(90deg, #4a5568 ${fill}%, #e2e8f0 ${fill}%)` }))
  }
  return wrap
}

function probRow(label: string, p: number): HTMLElement {
  const band = riskBand(p)
  return h("div", { class: "row" },
    h("span", { class: "label", text: label }),
    h("span", { class: "val" },
      h("span", { class: "band", text: band, style: `color: ${BAND_COLORS[band]}` }),
      h("span", { text: p.toFixed(2) })))
}

function buildPanel(o: Outcome, mode: PanelMode): HTMLElement {
  const panel = h("div", { class: "panel" })

  if (o.kind === "result") {
    const level = getAlertLevel(o.result)
    const head = level === "red" ? "🔴  发送前注意" : level === "warn" ? "⚠️  发送前注意" : "检查完成"
    panel.append(h("div", { class: `head ${level}`, text: head }))
    panel.append(h("div", { class: "rows" },
      probRow("第三方隐私", o.result.thirdParty),
      probRow("身份可链接", o.result.identityLinkable),
      h("div", { class: "row" },
        h("span", { class: "label", text: "敏感类别" }),
        h("span", { class: "val", text: categoryLabel(o.result.sensitiveCategory) })),
      h("div", { class: "row" },
        h("span", { class: "label", text: "复核建议" }),
        h("span", { class: "val" }, bar(o.result.reviewWorthiness), h("span", { text: `${o.result.reviewWorthiness.toFixed(1)}/3` })))))
    panel.append(h("div", { class: "summary", text: `${getRiskSummary(o.result)}。` }))
    const note = providerNote(o.result.source)
    if (note) panel.append(h("div", { class: "note", text: note }))
    if (o.truncated) panel.append(h("div", { class: "note", text: `内容较长，仅检查了前 ${MAX_TEXT_LENGTH} 字。` }))
  } else if (o.kind === "words") {
    panel.append(h("div", { class: "head red", text: "🔴  命中自定义敏感词" }))
    panel.append(h("div", { class: "summary", text: `命中：${o.words.join("、")}。此检查在本地完成，未上传任何内容。` }))
  } else if (o.kind === "error") {
    panel.append(h("div", { class: "head error", text: "?  检查未完成" }))
    panel.append(h("div", {
      class: "summary",
      text: o.reason === "no-key"
        ? "尚未设置 API key，请在扩展弹窗中填写。本次未做检查，不代表内容安全。"
        : "检查未完成，请确认 API key 和网络。本次未做检查，不代表内容安全。"
    }))
  } else {
    panel.append(h("div", { class: "head none", text: "未检查" }))
    panel.append(h("div", {
      class: "summary",
      text: o.reason === "short" ? "内容较短且未涉及他人或敏感信息，未上传检查。" : o.reason === "empty" ? "输入框为空。" : "敏感字段（密码 / 支付 / 登录表单），不做处理。"
    }))
  }

  const actions = h("div", { class: "actions" })
  if (mode.kind === "presend") {
    const send = h("button", { text: "仍然发送" })
    const back = h("button", { class: "primary", text: "我再看看" })
    send.addEventListener("click", mode.onSend)
    back.addEventListener("click", mode.onBack)
    actions.append(send, back)
  } else {
    const close = h("button", { class: "primary", text: "知道了" })
    close.addEventListener("click", () => ui.hidePanel())
    actions.append(close)
  }
  panel.append(actions)
  return panel
}

const ui = new Ui()

// =====================================================================
// 站点适配层（发送前拦截）。每个站点单独实现选择器和「实际发送」动作。
// =====================================================================

interface SendAttempt {
  editor: HTMLElement
  /** 通过站点适配层执行真正的发送，而不是重放被拦截的原始事件 */
  send: () => void
  /** false 表示只需吞掉事件（如 mousedown），不启动检查 */
  start: boolean
}

interface SiteAdapter {
  events: string[]
  detect(e: Event): SendAttempt | null
}

/** 适配层执行发送时置为 true，拦截器看到后直接放行 */
let bypass = false

function withBypass(fn: () => void): void {
  bypass = true
  try {
    fn()
  } finally {
    bypass = false
  }
}

function dispatchClick(el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    button: 0,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2
  }
  el.dispatchEvent(new MouseEvent("mousedown", init))
  el.dispatchEvent(new MouseEvent("mouseup", init))
  el.dispatchEvent(new MouseEvent("click", init))
}

// ---- Gmail ----
const GMAIL_EDITOR = 'div[contenteditable="true"][g_editable="true"]'
// 发送按钮 tooltip 形如「发送 (Ctrl-Enter)」/「Send (⌘Enter)」，不依赖界面语言；.T-I.aoO 为兜底
const GMAIL_SEND = '[role="button"][data-tooltip*="Enter)"], [role="button"][aria-label*="Enter)"], .T-I.aoO'

function gmailComposeRoot(from: Element): Element | null {
  let node: Element | null = from
  for (let i = 0; node && i < 40; i++, node = node.parentElement) {
    if (node.querySelector(GMAIL_EDITOR) && node.querySelector(GMAIL_SEND)) return node
  }
  return null
}

function gmailAttempt(from: Element, start: boolean): SendAttempt | null {
  const root = gmailComposeRoot(from)
  const editor = root?.querySelector<HTMLElement>(GMAIL_EDITOR)
  const button = root?.querySelector<HTMLElement>(GMAIL_SEND)
  if (!editor || !button) return null
  return { editor, start, send: () => withBypass(() => dispatchClick(button)) }
}

const gmailAdapter: SiteAdapter = {
  events: ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "keydown", "keyup"],
  detect(e) {
    const t = eventTarget(e)
    if (!t) return null
    if (e instanceof MouseEvent) {
      if (e.button !== 0) return null
      const btn = t.closest(GMAIL_SEND)
      return btn ? gmailAttempt(btn, e.type === "click") : null
    }
    if (e instanceof KeyboardEvent) {
      if (e.isComposing) return null
      // 在发送按钮上按 Enter / 空格
      const btn = t.closest(GMAIL_SEND)
      if (btn && (e.key === "Enter" || e.key === " ")) return gmailAttempt(btn, e.type === "keydown")
      // 撰写区域内 Ctrl/⌘ + Enter
      if (e.type === "keydown" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) return gmailAttempt(t, true)
    }
    return null
  }
}

// ---- Discord ----
const DISCORD_EDITOR = 'div[role="textbox"][data-slate-editor="true"]'

function discordAutocompleteOpen(editor: HTMLElement): boolean {
  if (editor.getAttribute("aria-expanded") === "true") return true
  return !!document.querySelector('[class*="autocomplete"] [role="option"], [class*="autocomplete"] [role="listbox"]')
}

function discordSendEnter(editor: HTMLElement): void {
  editor.focus()
  const ev = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true, composed: true })
  // KeyboardEventInit 不支持 keyCode，补上以兼容依赖 keyCode 的处理逻辑
  Object.defineProperty(ev, "keyCode", { get: () => 13 })
  Object.defineProperty(ev, "which", { get: () => 13 })
  withBypass(() => editor.dispatchEvent(ev))
}

const discordAdapter: SiteAdapter = {
  events: ["keydown"],
  detect(e) {
    if (!(e instanceof KeyboardEvent)) return null
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229) return null
    const editor = eventTarget(e)?.closest<HTMLElement>(DISCORD_EDITOR)
    if (!editor || discordAutocompleteOpen(editor)) return null
    return { editor, start: true, send: () => discordSendEnter(editor) }
  }
}

const ADAPTERS: Record<string, SiteAdapter> = { gmail: gmailAdapter, discord: discordAdapter }

// =====================================================================
// 发送前检查（仅已适配站点）
// =====================================================================

let presendBusy = false

function installPresend(adapter: SiteAdapter): void {
  const handler = (e: Event) => {
    if (bypass || !e.isTrusted) return
    if (!runtimeOk()) return teardown()
    if (!config?.enabled || config.mode !== "presend") return
    const attempt = adapter.detect(e)
    if (!attempt) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (attempt.start && !presendBusy) void runPresend(attempt)
  }
  for (const type of adapter.events) on(window, type, handler)
}

async function runPresend(attempt: SendAttempt): Promise<void> {
  presendBusy = true
  const { editor } = attempt
  let outcome: Outcome | null
  try {
    ui.hidePanel()
    ui.showIcon(editor, "loading")
    outcome = await check(editor)
  } finally {
    presendBusy = false
  }
  if (!outcome || !alive) return

  const state = iconStateOf(outcome)
  if (!state) {
    // 无风险 / 未达上传条件：直接执行发送，不打扰用户
    ui.hideAll()
    attempt.send()
    return
  }
  ui.showIcon(editor, state)
  ui.showPanel(editor, outcome, {
    kind: "presend",
    onSend: () => {
      ui.hideAll()
      attempt.send()
    },
    onBack: () => {
      ui.hidePanel()
      editor.focus()
    }
  })
}

// =====================================================================
// 实时检查（用户在 popup 确认后才会开启；只提示，不拦截）
// =====================================================================

let realtimeTimer: ReturnType<typeof setTimeout> | undefined

function onUserInput(e: Event): void {
  if (!config?.enabled) return
  const el = editableFrom(eventTarget(e))
  if (!el) return

  if (config.mode === "presend") {
    // 内容变了，旧提示作废
    if (ui.anchorEl === el && !presendBusy) ui.hideAll()
    return
  }

  clearTimeout(realtimeTimer)
  cancelCurrent()
  if (isSensitiveField(el)) return
  realtimeTimer = setTimeout(() => void runRealtime(el), 1000)
}

async function runRealtime(el: HTMLElement): Promise<void> {
  if (!el.isConnected || !config?.enabled || config.mode !== "realtime") return
  ui.hidePanel()
  ui.showIcon(el, "loading")
  const outcome = await check(el)
  if (!outcome || !alive) return
  const state = iconStateOf(outcome)
  if (!state) {
    ui.hideAll()
    return
  }
  ui.showIcon(el, state)
  // 只放图标，点击图标才展开面板
  ui.setOutcome(outcome, { kind: "info" })
}

// =====================================================================
// 手动检查（popup 按钮触发，适用于所有已授权网站）
// =====================================================================

let lastFocused: HTMLElement | null = null

function manualCheck(): ManualCheckResponse {
  if (!config?.enabled) return { ok: false, reason: "disabled" }
  const el = lastFocused?.isConnected ? lastFocused : null
  if (!el) return { ok: false, reason: "no-input" }
  if (isSensitiveField(el)) return { ok: false, reason: "sensitive-field" }
  void (async () => {
    ui.hidePanel()
    ui.showIcon(el, "loading")
    const outcome = await check(el)
    if (!outcome || !alive) return
    const state = iconStateOf(outcome)
    if (state) ui.showIcon(el, state)
    else ui.hideIcon()
    ui.showPanel(el, outcome, { kind: "info" })
  })()
  return { ok: true }
}

// =====================================================================
// 启动
// =====================================================================

function onMessage(msg: ContentPush, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void): boolean {
  if (!alive) return false
  switch (msg.type) {
    case "configChanged":
      applyConfig(msg.config)
      return false
    case "revoked":
      // 本站授权可能被部分撤销，交给 background 判断是否仍被覆盖
      if (msg.origins.some(o => patternMatchesUrl(o, location.href))) void refreshConfig()
      return false
    case "manualCheck":
      sendResponse(manualCheck())
      return false
    default:
      return false
  }
}

chrome.runtime.onMessage.addListener(onMessage)
disposers.push(() => {
  try {
    chrome.runtime.onMessage.removeListener(onMessage)
  } catch {
    // 扩展上下文已失效
  }
})

on(document, "focusin", e => {
  const el = editableFrom(eventTarget(e))
  if (el) lastFocused = el
})
on(document, "input", onUserInput)
on(document, "compositionend", onUserInput)
// 站点发送后会直接清空输入框（不触发 input），此时收起过期的图标
const clearStaleIcon = () => setTimeout(() => {
  const anchor = ui.anchorEl
  if (anchor && !presendBusy && (!anchor.isConnected || !readText(anchor).trim())) ui.hideAll()
}, 100)
on(document, "keyup", clearStaleIcon)
on(document, "click", clearStaleIcon)
on(window, "pointerdown", e => {
  if (ui.panelOpen && !ui.containsEvent(e)) ui.hidePanel()
})
on(window, "scroll", () => ui.scheduleReposition())
on(window, "resize", () => ui.scheduleReposition())
on(document, "visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshConfig()
})

const site = supportedSiteFor(location.hostname)
if (site) installPresend(ADAPTERS[site.id]!)

void refreshConfig()
