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

/**
 * 发送对象（粗粒度）。只描述「私聊还是群」和大致人数，绝不包含名字、邮箱、用户名。
 * size：direct 固定 1；group 为 small(2–10) / medium(11–50) / large(50+) / unknown
 */
export type AudienceKind = "direct" | "group"
export type AudienceSize = "small" | "medium" | "large" | "unknown"

export interface Audience {
  kind: AudienceKind
  size?: AudienceSize
}

export function isAudience(v: unknown): v is Audience {
  if (typeof v !== "object" || v === null) return false
  const a = v as Record<string, unknown>
  if (a.kind !== "direct" && a.kind !== "group") return false
  return a.size === undefined || ["small", "medium", "large", "unknown"].includes(a.size as string)
}

/** 人数 → 区间；0 或无法统计时返回 undefined */
export function audienceFromCount(count: number): Audience | undefined {
  if (!Number.isFinite(count) || count <= 0) return undefined
  if (count === 1) return { kind: "direct" }
  return { kind: "group", size: count <= 10 ? "small" : count <= 50 ? "medium" : "large" }
}

export interface AnalyzeInput {
  text: string                    // 即将发送的内容，最多 1000 字符（超出部分由 analyze 截断）
  recipientContext?: string       // 用户填写，例如"我的同事"；未填时 state 中注明"收件人未知"
  relationship?: Relationship | string
  site?: string                   // 当前域名
  conversationContext?: string    // 可选：前几条消息摘要
  audience?: Audience             // 可选：扩展自动识别的发送对象（粗粒度）
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
  tokenUsage?: TokenUsage         // 来自响应的 usage 字段，可能不存在
  costUsd?: number                // 服务端返回的实际费用（OpenRouter 提供；Jev 不提供）
  source?: Provider               // 由哪个检测服务给出
  raw: Record<string, unknown>    // 仅在内存中使用，不持久化，不打日志
}

/** 检测服务。jev = TypeSafe Jev（校准概率）；deepseek / openrouter = 通用大模型临时替代（概率未校准） */
export type Provider = "jev" | "deepseek" | "openrouter"

export const PROVIDERS: readonly Provider[] = ["jev", "deepseek", "openrouter"]

/** 去掉 raw 之后可以跨进程传递的结果 */
export type JevResultPublic = Omit<JevResult, "raw">

/** 面板 / 图标的告警级别 */
export type AlertLevel = "none" | "warn" | "red"

/** 单项指标的高 / 中 / 低 */
export type RiskBand = "HIGH" | "MED" | "LOW"
