import type { AlertLevel, Audience, JevResultPublic, Provider, RiskBand } from "./types"

// 所有 UI 文案都在这里 deterministic 生成，不调用任何生成式模型。

export const CATEGORY_LABELS: Record<string, string> = {
  health: "健康医疗",
  financial: "财务信息",
  relationship: "关系状态",
  location: "位置信息",
  professional: "职业信息",
  none: ""
}

type RiskInput = Pick<JevResultPublic, "thirdParty" | "identityLinkable" | "sensitiveCategory" | "reviewWorthiness"> &
  Partial<Pick<JevResultPublic, "source">>

export function categoryLabel(category: string): string {
  if (category === "none") return "无"
  return CATEGORY_LABELS[category] || category
}

function riskLines(result: RiskInput): string[] {
  const lines: string[] = []

  if (result.thirdParty >= 0.8)
    lines.push("可能包含第三方隐私信息")

  if (result.identityLinkable >= 0.75)
    lines.push("内容可能帮助收件人识别具体人物")

  // sensitiveCategory 只作为辅助信息展示，不单独触发警告
  // （用户向医生描述自己的病情也属于 health，类别本身不等于披露越界）
  if (result.sensitiveCategory !== "none" && result.reviewWorthiness >= 1.5)
    lines.push(`涉及${categoryLabel(result.sensitiveCategory)}相关内容`)

  if (result.reviewWorthiness >= 2.4)
    lines.push("建议发送前再检查一遍")

  return lines
}

export function getRiskSummary(result: RiskInput): string {
  if (isLlmSource(result) && getAlertLevel(result) === "none") return "未检测到明显风险"
  return riskLines(result).join("；") || "未检测到明显风险"
}

/**
 * 通用大模型（DeepSeek / OpenRouter）的判定阈值。
 * 2026-09-25 用 58 条中文样本在 deepseek-flash 上校准：模型只要提到别人就把 thirdParty 打到 0.85+，
 * 连「恭喜张伟升职」都会触发；而 reviewWorthiness 能干净地分开两组——
 * 该提醒的全部 ≥ 2.5，不该提醒 / 多余提醒的全部 ≤ 2.0。所以只用 reviewWorthiness 触发。
 * 另用 20 条未参与调参的样本验证：该提醒的最低 2.2，不该提醒的最高 0.4；阈值取两组之间的 2.1（漏报比多提醒更糟）。
 */
export const LLM_WARN_REVIEW = 2.1
export const LLM_RED_REVIEW = 2.8

function isLlmSource(result: RiskInput): boolean {
  return result.source === "deepseek" || result.source === "openrouter"
}

/**
 * Jev（校准概率）：摘要里有任何一条风险 → warn；满足红色条件 → red；否则 none（图标消失、直接放行）。
 * 通用大模型：只看 reviewWorthiness，见上方校准说明。
 */
export function getAlertLevel(result: RiskInput): AlertLevel {
  if (isLlmSource(result)) {
    const rw = result.reviewWorthiness
    if (rw >= LLM_RED_REVIEW || (rw >= LLM_WARN_REVIEW && result.thirdParty >= 0.85 && result.identityLinkable >= 0.8))
      return "red"
    return rw >= LLM_WARN_REVIEW ? "warn" : "none"
  }
  if ((result.thirdParty >= 0.85 && result.identityLinkable >= 0.8) || result.reviewWorthiness >= 2.8)
    return "red"
  return riskLines(result).length > 0 ? "warn" : "none"
}

export function riskBand(p: number): RiskBand {
  if (p >= 0.8) return "HIGH"
  if (p >= 0.5) return "MED"
  return "LOW"
}

export const BAND_COLORS: Record<RiskBand, string> = {
  HIGH: "#e53e3e",
  MED: "#dd6b20",
  LOW: "#38a169"
}

/** 按 $0.042 / 1M input tokens 估算 */
export const ESTIMATE_USD_PER_M_INPUT = 0.042

export function estimateCostUsd(inputTokens: number): number {
  return (inputTokens / 1_000_000) * ESTIMATE_USD_PER_M_INPUT
}

export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return "<$0.01"
  return `$${v.toFixed(2)}`
}

/** DeepSeek 不返回金额，按官方高峰价估算（上限）：输入 ¥2/M（缓存未命中）、输出 ¥8/M */
export const DEEPSEEK_CNY_PER_M_INPUT = 2
export const DEEPSEEK_CNY_PER_M_OUTPUT = 8

export function estimateDeepseekCny(input: number, output: number): number {
  return (input / 1_000_000) * DEEPSEEK_CNY_PER_M_INPUT + (output / 1_000_000) * DEEPSEEK_CNY_PER_M_OUTPUT
}

export function formatCny(v: number): string {
  if (v > 0 && v < 0.01) return "<¥0.01"
  return `¥${v.toFixed(2)}`
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  jev: "TypeSafe Jev",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter"
}

/** 非 Jev 的结果在面板上附带说明 */
export function providerNote(source: Provider | undefined): string {
  if (!source || source === "jev") return ""
  return `由 ${PROVIDER_LABELS[source]} 通用模型估算，概率未经校准，仅供参考。`
}

const SIZE_ZH: Record<string, string> = { small: "约 2–10 人", medium: "约 11–50 人", large: "50 人以上", unknown: "人数未知" }

/** 面板上显示的发送对象；未识别时说明用的是默认上下文 */
export function describeAudienceZh(a: Audience | undefined): string {
  if (!a) return "未识别（用默认上下文）"
  if (a.kind === "direct") return "私聊 / 单个收件人"
  return `群聊 / 多个收件人（${SIZE_ZH[a.size ?? "unknown"]}）`
}
