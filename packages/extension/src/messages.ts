import type { JevResultPublic, Relationship } from "@send-guard/core"

export type TriggerMode = "presend" | "realtime"

/** content script 能拿到的配置。绝不包含 API key。 */
export interface ContentConfig {
  enabled: boolean
  mode: TriggerMode               // realtime 仅在用户确认过实时上传后才会出现
  sensitiveWords: string[]
  recipientContext: string
  relationship: Relationship | ""
  rulesVersion: number
}

/** getConfig 的响应：allowed=false 表示本页所在网站已被撤销授权 */
export interface ConfigResponse {
  config: ContentConfig
  allowed: boolean
}

export interface Settings {
  enabled: boolean
  mode: TriggerMode
  realtimeConsent: boolean
  recipientContext: string
  relationship: Relationship | ""
  sensitiveWords: string
}

export interface MonthStats {
  month: string
  count: number
  input: number
  output: number
}

export interface PopupState {
  settings: Settings
  hasKey: boolean
  sites: string[]                 // 已授权的 origin pattern
  stats: MonthStats
}

// content → background
export type ContentRequest =
  | { type: "getConfig" }
  | { type: "analyze"; requestId: string; text: string }
  | { type: "cancel"; requestId: string }

export type AnalyzeResponse =
  | { requestId: string; ok: true; result: JevResultPublic }
  | { requestId: string; error: true; reason?: "no-key" | "revoked" | "cancelled" | "failed" }

// popup → background
export type PopupRequest =
  | { type: "getPopupState" }
  | { type: "saveSettings"; settings: Partial<Settings> }
  | { type: "saveApiKey"; apiKey: string }
  | { type: "testConnection" }
  | { type: "removeSite"; origin: string }

export type TestConnectionResponse = { ok: true } | { ok: false; reason: string }

// background / popup → content
export type ContentPush =
  | { type: "configChanged"; config: ContentConfig }
  | { type: "revoked"; origins: string[] }
  | { type: "manualCheck" }

export type ManualCheckResponse = { ok: true } | { ok: false; reason: "no-input" | "sensitive-field" | "disabled" }
