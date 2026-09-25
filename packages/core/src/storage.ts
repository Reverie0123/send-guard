import type { Provider } from "./types"

/**
 * 存储抽象。扩展版用 chrome.storage.local 实现，桌面版后续用 electron-store 实现。
 * 只存字符串和数字，结构化数据由调用方自行 JSON 序列化。
 */
export interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  getNumber(key: string): Promise<number>
  setNumber(key: string, value: number): Promise<void>
}

export const STORAGE_KEYS = {
  apiKey: "apiKey",                       // TypeSafe Jev key（其他服务见 providerKeyName）
  provider: "provider",                   // "jev" | "deepseek" | "openrouter"
  enabled: "enabled",                     // "1" | "0"，缺省视为开启
  autoAudience: "autoAudience",           // "0" 关闭自动识别发送对象，缺省开启
  mode: "mode",                           // "presend" | "realtime"
  realtimeConsent: "realtimeConsent",     // "1" 表示用户已确认草稿会实时上传
  recipientContext: "recipientContext",
  relationship: "relationship",
  sensitiveWords: "sensitiveWords",       // 逗号分隔原文
  rulesVersion: "rulesVersion"            // 影响判断的设置每变一次 +1，用于缓存失效
} as const

/** 各检测服务的 API key 分开保存，切换服务不会互相覆盖 */
export function providerKeyName(provider: Provider): string {
  return provider === "jev" ? STORAGE_KEYS.apiKey : `${provider}Key`
}

/** 用户自定义的模型名（仅 deepseek / openrouter） */
export function providerModelName(provider: Provider): string {
  return `${provider}Model`
}

export type StatsField =
  | "count" | "input" | "output"          // 所有服务合计
  | "jevInput"                            // Jev 输入 token，按 $0.042/M 估算
  | "deepseekInput" | "deepseekOutput"    // DeepSeek token，按人民币价估算
  | "costMicroUsd"                        // OpenRouter 返回的实际费用（百万分之一美元）

/** 按月统计的 key，例如 stats:2026-09:input */
export function statsKey(month: string, field: StatsField): string {
  return `stats:${month}:${field}`
}

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}
