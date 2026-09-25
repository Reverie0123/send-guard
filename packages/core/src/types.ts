export type Relationship = "colleague" | "friend" | "stranger" | "group" | "other"

export const RELATIONSHIPS: readonly Relationship[] = ["colleague", "friend", "stranger", "group", "other"]

export const SENSITIVE_CATEGORIES = [
  "health",
  "financial",
  "relationship",
  "location",
  "professional",
  "none"
] as const

export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number]

export interface AnalyzeInput {
  text: string                    // 即将发送的内容，最多 1000 字符（超出部分由 analyze 截断）
  recipientContext?: string       // 用户填写，例如"我的同事"；未填时 state 中注明"收件人未知"
  relationship?: Relationship | string
  site?: string                   // 当前域名
  conversationContext?: string    // 可选：前几条消息摘要
}

export interface TokenUsage {
  input: number
  output: number
}

export interface JevResult {
  thirdParty: number              // Noul，P(yes)，0–1
  identityLinkable: number        // Noul，P(yes)，0–1
  sensitiveCategory: string       // Choice 结果
  reviewWorthiness: number        // Score，可为小数，0–3
  tokenUsage?: TokenUsage         // 来自 Jev 响应的 usage 字段，可能不存在
  raw: Record<string, unknown>    // 仅在内存中使用，不持久化，不打日志
}

/** 去掉 raw 之后可以跨进程传递的结果 */
export type JevResultPublic = Omit<JevResult, "raw">

/** 面板 / 图标的告警级别 */
export type AlertLevel = "none" | "warn" | "red"

/** 单项指标的高 / 中 / 低 */
export type RiskBand = "HIGH" | "MED" | "LOW"
