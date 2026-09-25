import {
  analyze,
  currentMonth,
  JevError,
  RELATIONSHIPS,
  STORAGE_KEYS,
  statsKey,
  type JevResultPublic,
  type Relationship
} from "@send-guard/core"
import type {
  AnalyzeResponse,
  ConfigResponse,
  ContentConfig,
  ContentPush,
  ContentRequest,
  MonthStats,
  PopupRequest,
  PopupState,
  Settings,
  TestConnectionResponse
} from "./messages"
import { patternMatchesUrl } from "./sites"
import { ChromeStorageAdapter } from "./storage-impl"

const storage = new ChromeStorageAdapter()
const SCRIPT_ID = "send-guard-content"
const API_ORIGIN = "https://api.typesafe.ai/*"

// ---------- 设置 ----------

async function loadSettings(): Promise<Settings> {
  const [enabled, mode, consent, recipientContext, relationship, sensitiveWords] = await Promise.all([
    storage.get(STORAGE_KEYS.enabled),
    storage.get(STORAGE_KEYS.mode),
    storage.get(STORAGE_KEYS.realtimeConsent),
    storage.get(STORAGE_KEYS.recipientContext),
    storage.get(STORAGE_KEYS.relationship),
    storage.get(STORAGE_KEYS.sensitiveWords)
  ])
  return {
    enabled: enabled !== "0",
    mode: mode === "realtime" ? "realtime" : "presend",
    realtimeConsent: consent === "1",
    recipientContext: recipientContext ?? "",
    relationship: RELATIONSHIPS.includes(relationship as Relationship) ? (relationship as Relationship) : "",
    sensitiveWords: sensitiveWords ?? ""
  }
}

function parseWords(raw: string): string[] {
  return [...new Set(raw.split(/[,，]/).map(w => w.trim()).filter(Boolean))]
}

async function loadContentConfig(): Promise<ContentConfig> {
  const s = await loadSettings()
  return {
    enabled: s.enabled,
    // 没有确认过实时上传，一律按发送前检查处理
    mode: s.mode === "realtime" && s.realtimeConsent ? "realtime" : "presend",
    sensitiveWords: parseWords(s.sensitiveWords),
    recipientContext: s.recipientContext,
    relationship: s.relationship,
    rulesVersion: await storage.getNumber(STORAGE_KEYS.rulesVersion)
  }
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (patch.enabled !== undefined) await storage.set(STORAGE_KEYS.enabled, patch.enabled ? "1" : "0")
  if (patch.realtimeConsent !== undefined) await storage.set(STORAGE_KEYS.realtimeConsent, patch.realtimeConsent ? "1" : "0")
  if (patch.mode !== undefined) await storage.set(STORAGE_KEYS.mode, patch.mode)

  let rulesChanged = false
  if (patch.recipientContext !== undefined) {
    await storage.set(STORAGE_KEYS.recipientContext, patch.recipientContext.trim().slice(0, 200))
    rulesChanged = true
  }
  if (patch.relationship !== undefined) {
    const r = RELATIONSHIPS.includes(patch.relationship as Relationship) ? patch.relationship : ""
    await storage.set(STORAGE_KEYS.relationship, r)
    rulesChanged = true
  }
  if (patch.sensitiveWords !== undefined) {
    await storage.set(STORAGE_KEYS.sensitiveWords, patch.sensitiveWords)
    rulesChanged = true
  }
  if (rulesChanged) {
    const v = await storage.getNumber(STORAGE_KEYS.rulesVersion)
    await storage.setNumber(STORAGE_KEYS.rulesVersion, v + 1)
  }
  await broadcast({ type: "configChanged", config: await loadContentConfig() })
}

// ---------- 统计 ----------

let statsChain: Promise<void> = Promise.resolve()

function recordUsage(usage: JevResultPublic["tokenUsage"], countAsCheck: boolean): Promise<void> {
  statsChain = statsChain.then(async () => {
    const month = currentMonth()
    if (countAsCheck) {
      const k = statsKey(month, "count")
      await storage.setNumber(k, (await storage.getNumber(k)) + 1)
    }
    if (usage) {
      const ki = statsKey(month, "input")
      const ko = statsKey(month, "output")
      await storage.setNumber(ki, (await storage.getNumber(ki)) + usage.input)
      await storage.setNumber(ko, (await storage.getNumber(ko)) + usage.output)
    }
  }).catch(() => {})
  return statsChain
}

async function loadStats(): Promise<MonthStats> {
  const month = currentMonth()
  const [count, input, output] = await Promise.all([
    storage.getNumber(statsKey(month, "count")),
    storage.getNumber(statsKey(month, "input")),
    storage.getNumber(statsKey(month, "output"))
  ])
  return { month, count, input, output }
}

// ---------- 分析请求（含请求 ID 与取消） ----------

/** 已收到取消消息的请求 ID。未发出的不再发出；已发出的返回后丢弃。 */
const cancelled = new Set<string>()

function stripRaw(r: { raw: unknown } & JevResultPublic): JevResultPublic {
  const { raw: _raw, ...rest } = r
  return rest
}

/** 发送方页面仍在授权范围内时返回其 hostname，否则 null */
async function senderAllowedHost(sender: chrome.runtime.MessageSender): Promise<string | null> {
  let url: URL
  try {
    url = new URL(sender.url ?? sender.tab?.url ?? "")
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  return (await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) ? url.hostname : null
}

async function handleAnalyze(requestId: string, text: string, sender: chrome.runtime.MessageSender): Promise<AnalyzeResponse> {
  try {
    // 用户撤销权限后立即停止工作
    const hostname = await senderAllowedHost(sender)
    if (!hostname) return { requestId, error: true, reason: "revoked" }

    const apiKey = await storage.get(STORAGE_KEYS.apiKey)
    if (!apiKey) return { requestId, error: true, reason: "no-key" }

    const s = await loadSettings()
    if (cancelled.has(requestId)) return { requestId, error: true, reason: "cancelled" }

    const result = await analyze(
      {
        text,
        recipientContext: s.recipientContext || undefined,
        relationship: s.relationship || undefined,
        site: hostname
      },
      apiKey
    )

    // 请求已经花了 token，统计照记；但已取消的结果直接丢弃，不回给页面
    await recordUsage(result.tokenUsage, !cancelled.has(requestId))
    if (cancelled.has(requestId)) return { requestId, error: true, reason: "cancelled" }
    return { requestId, ok: true, result: stripRaw(result) }
  } catch (e) {
    // fail-closed：任何失败都只回 error，不回任何「低风险」结果；不记录错误详情
    return { requestId, error: true, reason: e instanceof JevError && e.kind === "no-key" ? "no-key" : "failed" }
  } finally {
    cancelled.delete(requestId)
  }
}

async function testConnection(): Promise<TestConnectionResponse> {
  const apiKey = await storage.get(STORAGE_KEYS.apiKey)
  if (!apiKey) return { ok: false, reason: "尚未保存 API key" }
  try {
    const r = await analyze({ text: "Hi, see you at the meeting tomorrow.", site: "connection-test" }, apiKey)
    await recordUsage(r.tokenUsage, false)
    return { ok: true }
  } catch (e) {
    if (e instanceof JevError) {
      if (e.kind === "http" && (e.status === 401 || e.status === 403)) return { ok: false, reason: "API key 无效或无权限" }
      if (e.kind === "http") return { ok: false, reason: `服务返回错误 ${e.status}` }
      if (e.kind === "timeout") return { ok: false, reason: "请求超时" }
      if (e.kind === "bad-response") return { ok: false, reason: "响应格式无法识别" }
    }
    return { ok: false, reason: "网络错误" }
  }
}

// ---------- 网站授权 → content script 注册 ----------

async function siteOrigins(): Promise<string[]> {
  const { origins = [] } = await chrome.permissions.getAll()
  return origins.filter(o => o !== API_ORIGIN)
}

let syncChain: Promise<void> = Promise.resolve()

function syncContentScripts(): Promise<void> {
  syncChain = syncChain.then(async () => {
    const origins = await siteOrigins()
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
    if (origins.length) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID,
        js: ["content.js"],
        matches: origins,
        runAt: "document_idle",
        persistAcrossSessions: true
      }])
    }
  }).catch(() => {})
  return syncChain
}

/** 给已打开、且已授权的标签页立即注入（content.js 自己防重复注入） */
async function injectIntoOpenTabs(origins: string[]): Promise<void> {
  if (!origins.length) return
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.map(async tab => {
    if (tab.id === undefined || !tab.url) return
    if (!origins.some(o => patternMatchesUrl(o, tab.url!))) return
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
    } catch {
      // chrome:// 页面、已关闭的标签页等，忽略
    }
  }))
}

async function broadcast(msg: ContentPush): Promise<void> {
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.map(t => t.id === undefined ? undefined : chrome.tabs.sendMessage(t.id, msg).catch(() => {})))
}

chrome.permissions.onAdded.addListener(async perms => {
  const added = (perms.origins ?? []).filter(o => o !== API_ORIGIN)
  await syncContentScripts()
  await injectIntoOpenTabs(added)
})

chrome.permissions.onRemoved.addListener(async perms => {
  await syncContentScripts()
  const removed = perms.origins ?? []
  if (removed.length) await broadcast({ type: "revoked", origins: removed })
})

chrome.runtime.onInstalled.addListener(async () => {
  await syncContentScripts()
  await injectIntoOpenTabs(await siteOrigins())
})

chrome.runtime.onStartup.addListener(() => {
  void syncContentScripts()
})

// ---------- 消息路由 ----------

function isFromPopup(sender: chrome.runtime.MessageSender): boolean {
  return !sender.tab && !!sender.url?.startsWith(chrome.runtime.getURL(""))
}

chrome.runtime.onMessage.addListener((msg: ContentRequest | PopupRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false

  const reply = (p: Promise<unknown>) => {
    p.then(sendResponse, () => sendResponse(undefined))
    return true
  }

  // content script 只能用这三种消息，拿不到 key、设置写入等能力
  if (sender.tab) {
    switch (msg.type) {
      case "getConfig":
        return reply((async (): Promise<ConfigResponse> => ({
          config: await loadContentConfig(),
          allowed: (await senderAllowedHost(sender)) !== null
        }))())
      case "analyze":
        if (typeof msg.requestId !== "string" || typeof msg.text !== "string") return false
        return reply(handleAnalyze(msg.requestId, msg.text, sender))
      case "cancel":
        if (typeof msg.requestId === "string") {
          const id = msg.requestId
          cancelled.add(id)
          // 取消消息晚于结果到达时，这条记录不会被 finally 清掉，定时兜底清理
          setTimeout(() => cancelled.delete(id), 60_000)
        }
        return false
      default:
        return false
    }
  }

  if (!isFromPopup(sender)) return false

  switch (msg.type) {
    case "getPopupState":
      return reply((async (): Promise<PopupState> => ({
        settings: await loadSettings(),
        hasKey: !!(await storage.get(STORAGE_KEYS.apiKey)),
        sites: await siteOrigins(),
        stats: await loadStats()
      }))())
    case "saveSettings":
      return reply(saveSettings(msg.settings).then(() => true))
    case "saveApiKey":
      return reply(storage.set(STORAGE_KEYS.apiKey, msg.apiKey.trim()).then(() => true))
    case "testConnection":
      return reply(testConnection())
    case "removeSite":
      return reply(chrome.permissions.remove({ origins: [msg.origin] }))
    default:
      return false
  }
})
