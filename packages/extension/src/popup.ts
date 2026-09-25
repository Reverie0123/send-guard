import { ESTIMATE_USD_PER_M_INPUT, estimateCostUsd, formatUsd } from "@send-guard/core"
import type { ManualCheckResponse, PopupRequest, PopupState, Settings, TestConnectionResponse } from "./messages"
import { patternMatchesUrl, SUPPORTED_SITES, supportedSiteFor } from "./sites"

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const el = {
  version: $("version"),
  enabled: $<HTMLInputElement>("enabled"),
  siteName: $("siteName"),
  siteTag: $("siteTag"),
  enableSite: $<HTMLButtonElement>("enableSite"),
  manualCheck: $<HTMLButtonElement>("manualCheck"),
  siteMsg: $("siteMsg"),
  apiKey: $<HTMLInputElement>("apiKey"),
  saveKey: $<HTMLButtonElement>("saveKey"),
  keyMsg: $("keyMsg"),
  modePresend: $<HTMLInputElement>("modePresend"),
  modeRealtime: $<HTMLInputElement>("modeRealtime"),
  consentBox: $("consentBox"),
  consent: $<HTMLInputElement>("consent"),
  recipientContext: $<HTMLInputElement>("recipientContext"),
  relationship: $<HTMLSelectElement>("relationship"),
  sensitiveWords: $<HTMLTextAreaElement>("sensitiveWords"),
  sites: $<HTMLUListElement>("sites"),
  sitesEmpty: $("sitesEmpty"),
  statsLine: $("statsLine"),
  costLine: $("costLine")
}

function send<T>(msg: PopupRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>
}

function saveSettings(settings: Partial<Settings>): Promise<unknown> {
  return send({ type: "saveSettings", settings })
}

let state: PopupState
let tab: chrome.tabs.Tab | undefined
let tabPattern: string | null = null

async function load(): Promise<void> {
  state = await send<PopupState>({ type: "getPopupState" })
  ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  render()
}

function render(): void {
  const s = state.settings
  el.version.textContent = `v${chrome.runtime.getManifest().version}`
  el.enabled.checked = s.enabled
  el.apiKey.placeholder = state.hasKey ? "已保存（输入新 key 可覆盖）" : "粘贴你的 API key"

  el.modePresend.checked = s.mode === "presend" || !s.realtimeConsent
  el.modeRealtime.checked = s.mode === "realtime" && s.realtimeConsent
  el.consent.checked = s.realtimeConsent
  el.consentBox.hidden = !el.modeRealtime.checked

  if (document.activeElement !== el.recipientContext) el.recipientContext.value = s.recipientContext
  el.relationship.value = s.relationship
  if (document.activeElement !== el.sensitiveWords) el.sensitiveWords.value = s.sensitiveWords

  renderCurrentSite()
  renderSites()
  renderStats()
}

function renderCurrentSite(): void {
  el.enableSite.hidden = el.manualCheck.hidden = true
  el.siteTag.textContent = ""
  tabPattern = null
  let url: URL | null = null
  try {
    url = tab?.url ? new URL(tab.url) : null
  } catch {
    url = null
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    el.siteName.textContent = "此页面不支持"
    return
  }
  el.siteName.textContent = url.hostname
  tabPattern = `${url.protocol}//${url.hostname}/*`
  const supported = supportedSiteFor(url.hostname)
  const enabled = state.sites.some(p => patternMatchesUrl(p, url!.href))
  if (enabled) {
    el.siteTag.textContent = supported ? "发送前拦截" : "手动检查"
    el.siteTag.className = supported ? "tag verified" : "tag"
    el.manualCheck.hidden = false
  } else {
    el.siteTag.textContent = "未启用"
    el.siteTag.className = "tag"
    el.enableSite.hidden = false
  }
}

function renderSites(): void {
  el.sites.replaceChildren()
  el.sitesEmpty.hidden = state.sites.length > 0
  for (const origin of state.sites) {
    const li = document.createElement("li")
    const name = document.createElement("span")
    name.className = "origin"
    name.textContent = origin.replace(/\/\*$/, "")
    name.title = origin
    const tag = document.createElement("span")
    const supported = SUPPORTED_SITES.some(s => patternMatchesUrl(origin, `https://${s.host}/`))
    tag.className = supported ? "tag verified" : "tag"
    tag.textContent = supported ? "发送前拦截" : "手动检查"
    const rm = document.createElement("button")
    rm.textContent = "移除"
    rm.addEventListener("click", async () => {
      rm.disabled = true
      await send({ type: "removeSite", origin })
      await load()
    })
    li.append(name, tag, rm)
    el.sites.append(li)
  }
}

function renderStats(): void {
  const { count, input, output } = state.stats
  el.statsLine.textContent = `本月已检查 ${count} 条，使用 input ${input} / output ${output} tokens`
  // 当前 API 响应没有金额字段，只能估算
  el.costLine.textContent = `估算费用约 ${formatUsd(estimateCostUsd(input))}（按 $${ESTIMATE_USD_PER_M_INPUT}/1M input tokens 估算）`
}

// ---------- 事件 ----------

el.enabled.addEventListener("change", () => saveSettings({ enabled: el.enabled.checked }))

el.saveKey.addEventListener("click", async () => {
  const key = el.apiKey.value.trim()
  el.saveKey.disabled = true
  el.keyMsg.className = "muted"
  try {
    if (key) {
      await send({ type: "saveApiKey", apiKey: key })
      el.apiKey.value = ""
      state.hasKey = true
      render()
    }
    el.keyMsg.textContent = "测试中…"
    const r = await send<TestConnectionResponse>({ type: "testConnection" })
    el.keyMsg.textContent = r.ok ? "连接成功" : r.reason
    el.keyMsg.className = r.ok ? "ok" : "bad"
    state = await send<PopupState>({ type: "getPopupState" })
    renderStats()
  } finally {
    el.saveKey.disabled = false
  }
})

el.modePresend.addEventListener("change", () => {
  if (!el.modePresend.checked) return
  el.consentBox.hidden = true
  void saveSettings({ mode: "presend" })
})

el.modeRealtime.addEventListener("change", () => {
  if (!el.modeRealtime.checked) return
  el.consentBox.hidden = false
  if (!el.consent.checked) {
    // 未确认前不切换，仍保持发送前检查
    el.modePresend.checked = true
    return
  }
  void saveSettings({ mode: "realtime" })
})

el.consent.addEventListener("change", async () => {
  if (el.consent.checked) {
    el.modeRealtime.checked = true
    await saveSettings({ realtimeConsent: true, mode: "realtime" })
  } else {
    el.modePresend.checked = true
    el.consentBox.hidden = true
    await saveSettings({ realtimeConsent: false, mode: "presend" })
  }
})

el.recipientContext.addEventListener("change", () => saveSettings({ recipientContext: el.recipientContext.value }))
el.relationship.addEventListener("change", () => saveSettings({ relationship: el.relationship.value as Settings["relationship"] }))
el.sensitiveWords.addEventListener("change", () => saveSettings({ sensitiveWords: el.sensitiveWords.value }))

el.enableSite.addEventListener("click", async () => {
  if (!tabPattern) return
  // 授权后由 background 的 permissions.onAdded 负责注册并注入 content script
  const granted = await chrome.permissions.request({ origins: [tabPattern] }).catch(() => false)
  el.siteMsg.textContent = granted ? "已启用。" : "未授权。"
  await load()
})

el.manualCheck.addEventListener("click", async () => {
  if (tab?.id === undefined) return
  el.siteMsg.textContent = ""
  let r: ManualCheckResponse | undefined
  try {
    r = (await chrome.tabs.sendMessage(tab.id, { type: "manualCheck" })) as ManualCheckResponse
  } catch {
    el.siteMsg.textContent = "页面上还没有加载 Send Guard，请刷新页面后再试。"
    return
  }
  if (r?.ok) {
    window.close()
    return
  }
  el.siteMsg.textContent = {
    "no-input": "请先点一下要检查的输入框，再点这个按钮。",
    "sensitive-field": "这是密码 / 支付 / 登录字段，不做检查。",
    disabled: "Send Guard 已关闭。"
  }[r?.reason ?? "no-input"]
})

void load()
