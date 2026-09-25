import {
  DEEPSEEK_CNY_PER_M_INPUT,
  DEEPSEEK_CNY_PER_M_OUTPUT,
  ESTIMATE_USD_PER_M_INPUT,
  estimateCostUsd,
  estimateDeepseekCny,
  formatCny,
  formatUsd,
  LLM_PRESETS,
  PROVIDER_LABELS,
  type Provider
} from "@send-guard/core"
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
  provider: $<HTMLSelectElement>("provider"),
  providerNote: $("providerNote"),
  apiKey: $<HTMLInputElement>("apiKey"),
  modelRow: $("modelRow"),
  model: $<HTMLInputElement>("model"),
  saveKey: $<HTMLButtonElement>("saveKey"),
  keyMsg: $("keyMsg"),
  modePresend: $<HTMLInputElement>("modePresend"),
  modeRealtime: $<HTMLInputElement>("modeRealtime"),
  consentBox: $("consentBox"),
  consent: $<HTMLInputElement>("consent"),
  recipientContext: $<HTMLInputElement>("recipientContext"),
  relationship: $<HTMLSelectElement>("relationship"),
  autoAudience: $<HTMLInputElement>("autoAudience"),
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
  el.provider.value = s.provider
  renderProvider()

  el.modePresend.checked = s.mode === "presend" || !s.realtimeConsent
  el.modeRealtime.checked = s.mode === "realtime" && s.realtimeConsent
  el.consent.checked = s.realtimeConsent
  el.consentBox.hidden = !el.modeRealtime.checked

  if (document.activeElement !== el.recipientContext) el.recipientContext.value = s.recipientContext
  el.relationship.value = s.relationship
  el.autoAudience.checked = s.autoAudience
  if (document.activeElement !== el.sensitiveWords) el.sensitiveWords.value = s.sensitiveWords

  renderCurrentSite()
  renderSites()
  renderStats()
}

const PROVIDER_NOTES: Record<Provider, string> = {
  jev: "消息会发送到 TypeSafe（api.typesafe.ai）做检查。",
  deepseek: "消息会发送到 DeepSeek 官方（api.deepseek.com）做检查。通用大模型给出的概率未经校准，仅作临时替代。",
  openrouter: "消息会经 OpenRouter 转发给所选模型的服务商做检查。通用大模型给出的概率未经校准，仅作临时替代。"
}

function renderProvider(): void {
  const p = el.provider.value as Provider
  el.providerNote.textContent = PROVIDER_NOTES[p]
  el.apiKey.value = ""
  el.apiKey.placeholder = state.hasKey[p]
    ? `${PROVIDER_LABELS[p]} key 已保存（输入新 key 可覆盖）`
    : `粘贴你的 ${PROVIDER_LABELS[p]} API key`
  el.keyMsg.textContent = ""
  if (p === "jev") {
    el.modelRow.hidden = true
    return
  }
  el.modelRow.hidden = false
  el.model.value = state.models[p]
  el.model.placeholder = `模型（默认 ${LLM_PRESETS[p].defaultModel}）`
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
  const { count, input, output, jevInput, deepseekInput, deepseekOutput, costUsd } = state.stats
  el.statsLine.textContent = `本月已检查 ${count} 条，使用 input ${input} / output ${output} tokens`
  const lines: string[] = []
  if (costUsd > 0) lines.push(`OpenRouter 实际费用 ${formatUsd(costUsd)}`)
  if (deepseekInput > 0) {
    lines.push(`DeepSeek 估算费用约 ${formatCny(estimateDeepseekCny(deepseekInput, deepseekOutput))}` +
      `（按高峰价 ¥${DEEPSEEK_CNY_PER_M_INPUT}/1M input、¥${DEEPSEEK_CNY_PER_M_OUTPUT}/1M output 估算）`)
  }
  // Jev 响应没有金额字段，只能估算；没有任何用量时也显示这一行
  if (jevInput > 0 || lines.length === 0) {
    lines.push(`Jev 估算费用约 ${formatUsd(estimateCostUsd(jevInput))}（按 $${ESTIMATE_USD_PER_M_INPUT}/1M input tokens 估算）`)
  }
  el.costLine.textContent = lines.join("；")
}

// ---------- 事件 ----------

el.enabled.addEventListener("change", () => saveSettings({ enabled: el.enabled.checked }))

el.provider.addEventListener("change", async () => {
  const provider = el.provider.value as Provider
  state.settings.provider = provider
  renderProvider()
  await saveSettings({ provider })
})

el.saveKey.addEventListener("click", async () => {
  const provider = el.provider.value as Provider
  const key = el.apiKey.value.trim()
  el.saveKey.disabled = true
  el.keyMsg.className = "muted"
  try {
    if (key) {
      await send({ type: "saveApiKey", provider, apiKey: key })
      state.hasKey[provider] = true
    }
    if (provider !== "jev" && el.model.value.trim() !== state.models[provider]) {
      await send({ type: "saveModel", provider, model: el.model.value })
      state.models[provider] = el.model.value.trim()
    }
    renderProvider()
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
el.autoAudience.addEventListener("change", () => saveSettings({ autoAudience: el.autoAudience.checked }))
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
