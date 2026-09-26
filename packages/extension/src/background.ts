import {
  analyze,
  analyzeWithLlm,
  currentMonth,
  isAudience,
  JevError,
  PROVIDERS,
  providerKeyName,
  providerModelName,
  RELATIONSHIPS,
  STORAGE_KEYS,
  statsKey,
  type AnalyzeInput,
  type Audience,
  type JevResult,
  type JevResultPublic,
  type LlmProvider,
  type Provider,
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
import { t } from "./i18n"
import { patternMatchesUrl } from "./sites"
import { ChromeStorageAdapter } from "./storage-impl"

const storage = new ChromeStorageAdapter()
const SCRIPT_ID = "send-guard-content"
/** manifest 里固定声明的检测服务域名，不算作用户启用的网站 */
const API_ORIGINS = ["https://api.typesafe.ai/*", "https://api.deepseek.com/*", "https://openrouter.ai/*"]

// ---------- 设置 ----------

async function loadSettings(): Promise<Settings> {
  const [enabled, provider, mode, consent, recipientContext, relationship, sensitiveWords, autoAudience] = await Promise.all([
    storage.get(STORAGE_KEYS.enabled),
    storage.get(STORAGE_KEYS.provider),
    storage.get(STORAGE_KEYS.mode),
    storage.get(STORAGE_KEYS.realtimeConsent),
    storage.get(STORAGE_KEYS.recipientContext),
    storage.get(STORAGE_KEYS.relationship),
    storage.get(STORAGE_KEYS.sensitiveWords),
    storage.get(STORAGE_KEYS.autoAudience)
  ])
  return {
    enabled: enabled !== "0",
    // TypeSafe 暂停了新账号注册（2026-09），新用户默认用 DeepSeek；已选过的服务保持不变
    provider: PROVIDERS.includes(provider as Provider) ? (provider as Provider) : "deepseek",
    mode: mode === "realtime" ? "realtime" : "presend",
    realtimeConsent: consent === "1",
    recipientContext: recipientContext ?? "",
    relationship: RELATIONSHIPS.includes(relationship as Relationship) ? (relationship as Relationship) : "",
    sensitiveWords: sensitiveWords ?? "",
    autoAudience: autoAudience !== "0"
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
    rulesVersion: await storage.getNumber(STORAGE_KEYS.rulesVersion),
    autoAudience: s.autoAudience
  }
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (patch.enabled !== undefined) await storage.set(STORAGE_KEYS.enabled, patch.enabled ? "1" : "0")
  if (patch.realtimeConsent !== undefined) await storage.set(STORAGE_KEYS.realtimeConsent, patch.realtimeConsent ? "1" : "0")
  if (patch.mode !== undefined) await storage.set(STORAGE_KEYS.mode, patch.mode)

  let rulesChanged = false
  if (patch.provider !== undefined && PROVIDERS.includes(patch.provider)) {
    await storage.set(STORAGE_KEYS.provider, patch.provider)
    rulesChanged = true // 换了检测服务，旧缓存作废
  }
  if (patch.recipientContext !== undefined) {
    await storage.set(STORAGE_KEYS.recipientContext, patch.recipientContext.trim().slice(0, 200))
    rulesChanged = true
  }
  if (patch.relationship !== undefined) {
    const r = RELATIONSHIPS.includes(patch.relationship as Relationship) ? patch.relationship : ""
    await storage.set(STORAGE_KEYS.relationship, r)
    rulesChanged = true
  }
  if (patch.autoAudience !== undefined) {
    await storage.set(STORAGE_KEYS.autoAudience, patch.autoAudience ? "1" : "0")
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

function recordUsage(result: JevResultPublic, countAsCheck: boolean): Promise<void> {
  statsChain = statsChain.then(async () => {
    const month = currentMonth()
    const add = async (field: Parameters<typeof statsKey>[1], n: number) => {
      const k = statsKey(month, field)
      await storage.setNumber(k, (await storage.getNumber(k)) + n)
    }
    if (countAsCheck) await add("count", 1)
    const usage = result.tokenUsage
    if (usage) {
      await add("input", usage.input)
      await add("output", usage.output)
      if (result.source === "jev") await add("jevInput", usage.input)
      if (result.source === "deepseek") {
        await add("deepseekInput", usage.input)
        await add("deepseekOutput", usage.output)
      }
    }
    if (result.costUsd !== undefined) await add("costMicroUsd", Math.round(result.costUsd * 1_000_000))
  }).catch(() => {})
  return statsChain
}

async function loadStats(): Promise<MonthStats> {
  const month = currentMonth()
  const fields = ["count", "input", "output", "jevInput", "deepseekInput", "deepseekOutput", "costMicroUsd"] as const
  const [count, input, output, jevInput, deepseekInput, deepseekOutput, costMicroUsd] =
    await Promise.all(fields.map(f => storage.getNumber(statsKey(month, f))))
  return {
    month,
    count: count!,
    input: input!,
    output: output!,
    jevInput: jevInput!,
    deepseekInput: deepseekInput!,
    deepseekOutput: deepseekOutput!,
    costUsd: costMicroUsd! / 1_000_000
  }
}

// ---------- 分析请求（含请求 ID 与取消） ----------

/** 按当前选择的检测服务调用。key 只在 background 读取。 */
async function runAnalysis(provider: Provider, input: AnalyzeInput): Promise<JevResult> {
  const apiKey = await storage.get(providerKeyName(provider))
  if (!apiKey) throw new JevError("no-key")
  if (provider === "jev") return analyze(input, apiKey)
  const model = (await storage.get(providerModelName(provider))) ?? ""
  return analyzeWithLlm(provider, input, apiKey, model || undefined)
}

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

async function handleAnalyze(
  requestId: string,
  text: string,
  audience: Audience | undefined,
  sender: chrome.runtime.MessageSender
): Promise<AnalyzeResponse> {
  try {
    // 用户撤销权限后立即停止工作
    const hostname = await senderAllowedHost(sender)
    if (!hostname) return { requestId, error: true, reason: "revoked" }

    const s = await loadSettings()
    if (cancelled.has(requestId)) return { requestId, error: true, reason: "cancelled" }

    const result = await runAnalysis(s.provider, {
      text,
      recipientContext: s.recipientContext || undefined,
      relationship: s.relationship || undefined,
      site: hostname,
      // 只接受合法的粗粒度取值；用户关闭自动识别时不上传
      audience: s.autoAudience && isAudience(audience) ? { kind: audience.kind, size: audience.size } : undefined
    })

    // 请求已经花了 token，统计照记；但已取消的结果直接丢弃，不回给页面
    await recordUsage(result, !cancelled.has(requestId))
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
  const { provider } = await loadSettings()
  try {
    const r = await runAnalysis(provider, { text: "Hi, see you at the meeting tomorrow.", site: "connection-test" })
    await recordUsage(r, false)
    return { ok: true }
  } catch (e) {
    if (e instanceof JevError) {
      if (e.kind === "no-key") return { ok: false, reason: t.testNoKey }
      if (e.kind === "http" && e.status === 402) return { ok: false, reason: t.testBalance }
      if (e.kind === "http" && (e.status === 401 || e.status === 403)) return { ok: false, reason: t.testInvalid }
      if (e.kind === "http") return { ok: false, reason: t.testHttp(e.status) }
      if (e.kind === "timeout") return { ok: false, reason: t.testTimeout }
      if (e.kind === "bad-response") return { ok: false, reason: t.testBadResponse }
    }
    return { ok: false, reason: t.testNetwork }
  }
}

// ---------- 网站授权 → content script 注册 ----------

async function siteOrigins(): Promise<string[]> {
  const { origins = [] } = await chrome.permissions.getAll()
  return origins.filter(o => !API_ORIGINS.includes(o))
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
  const added = (perms.origins ?? []).filter(o => !API_ORIGINS.includes(o))
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
        return reply(handleAnalyze(msg.requestId, msg.text, msg.audience, sender))
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
        hasKey: Object.fromEntries(await Promise.all(
          PROVIDERS.map(async p => [p, !!(await storage.get(providerKeyName(p)))] as const)
        )) as Record<Provider, boolean>,
        models: {
          deepseek: (await storage.get(providerModelName("deepseek"))) ?? "",
          openrouter: (await storage.get(providerModelName("openrouter"))) ?? ""
        },
        sites: await siteOrigins(),
        stats: await loadStats()
      }))())
    case "saveSettings":
      return reply(saveSettings(msg.settings).then(() => true))
    case "saveApiKey":
      if (!PROVIDERS.includes(msg.provider)) return false
      return reply(storage.set(providerKeyName(msg.provider), msg.apiKey.trim()).then(() => true))
    case "saveModel": {
      if (msg.provider !== "deepseek" && msg.provider !== "openrouter") return false
      const provider: LlmProvider = msg.provider
      return reply((async () => {
        await storage.set(providerModelName(provider), msg.model.trim().slice(0, 100))
        const v = await storage.getNumber(STORAGE_KEYS.rulesVersion)
        await storage.setNumber(STORAGE_KEYS.rulesVersion, v + 1)
        await broadcast({ type: "configChanged", config: await loadContentConfig() })
        return true
      })())
    }
    case "testConnection":
      return reply(testConnection())
    case "removeSite":
      return reply(chrome.permissions.remove({ origins: [msg.origin] }))
    default:
      return false
  }
})
