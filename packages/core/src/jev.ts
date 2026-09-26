import type { AnalyzeInput, Audience, JevResult, TokenUsage } from "./types"

// 接口结构已对照官方文档 https://docs.typesafe.ai/api 校对（2026-09-25）
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
export const JEV_MODEL = "jev-latest"
export const MAX_TEXT_LENGTH = 1000
const REQUEST_TIMEOUT_MS = 15_000

/** Jev 调用失败。message 里不含 API key 和消息内容。 */
export class JevError extends Error {
  constructor(
    readonly kind: "no-key" | "http" | "network" | "timeout" | "bad-response",
    readonly status?: number
  ) {
    super(status ? `jev ${kind} (${status})` : `jev ${kind}`)
    this.name = "JevError"
  }
}

const SIZE_EN: Record<string, string> = {
  small: "about 2-10 people",
  medium: "about 11-50 people",
  large: "more than 50 people",
  unknown: "possibly many people"
}

/** 给模型看的发送对象描述 */
export function describeAudienceEn(a: Audience): string {
  if (a.kind === "direct") return "direct message to one person"
  if (a.kind === "public") return "public post (anyone on the internet can read it, including strangers and the person being talked about)"
  return `group chat / channel / multiple recipients (${SIZE_EN[a.size ?? "unknown"]} can read it, not only the person being talked about)`
}

export function buildState(input: AnalyzeInput): string {
  const parts: string[] = [`Message: ${input.text.slice(0, MAX_TEXT_LENGTH)}`]

  if (input.recipientContext) {
    parts.push(`Recipient: ${input.recipientContext}`)
  } else {
    parts.push("Recipient: unknown (no context provided)")
  }

  if (input.relationship) parts.push(`Relationship: ${input.relationship}`)
  if (input.audience) parts.push(`Audience: ${describeAudienceEn(input.audience)}`)
  if (input.site) parts.push(`Platform: ${input.site}`)
  if (input.conversationContext) parts.push(`Recent context: ${input.conversationContext}`)

  return parts.join("\n")
}

export function buildQuestions() {
  return {
    third_party: {
      type: "noul",
      instructions: "Does this message reveal private information about a person other than the sender, that the stated recipient would not normally be expected to know? If recipient is unknown, assume a general audience."
    },
    identity_linkable: {
      type: "noul",
      instructions: "Could this message allow the recipient to identify or locate a specific person who did not choose to share that information with them?"
    },
    sensitive_category: {
      type: "choice",
      instructions: "What is the most sensitive category of information in this message?",
      criteria: {
        health: "Medical conditions, mental health, medications, hospital visits of any person",
        financial: "Income, debt, account details, financial hardship of any person",
        relationship: "Romantic status, family conflict, personal disputes of any person",
        location: "Home address, workplace, daily routine, whereabouts of any person",
        professional: "Employment status, work performance, career matters of any person",
        none: "No obviously sensitive category"
      }
    },
    review_worthiness: {
      type: "score",
      instructions: "How much would a reasonable sender benefit from pausing to review this message before sending, considering privacy and disclosure risk?",
      // Score criteria 必须是有序数组，对应 0–3 分
      criteria: [
        "No disclosure risk; clearly appropriate for this recipient",
        "Minor concern; sender is likely fine but a quick glance helps",
        "Moderate concern; information may exceed what recipient should know",
        "Significant concern; strong reason to pause before sending"
      ]
    }
  }
}

/**
 * 对外唯一函数。只依赖标准 fetch，无任何 chrome.* 或 Node.js API。
 * 任何失败都抛 JevError，调用方必须按「检查未完成」处理，不能当成低风险。
 */
export async function analyze(input: AnalyzeInput, apiKey: string): Promise<JevResult> {
  if (!apiKey) throw new JevError("no-key")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        state: buildState(input),
        model: JEV_MODEL,
        questions: buildQuestions()
      }),
      signal: controller.signal
    })
  } catch {
    throw new JevError(controller.signal.aborted ? "timeout" : "network")
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) throw new JevError("http", response.status)

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new JevError("bad-response")
  }
  return parseJevResponse(json)
}

/** 响应 → JevResult 的字段映射全部集中在这里，对照正式文档时只需改这一个函数。 */
export function parseJevResponse(json: unknown): JevResult {
  if (!isRecord(json) || !isRecord(json.answers)) throw new JevError("bad-response")
  const answers = json.answers

  const result: JevResult = {
    // Noul：{ type: "noul", noul: 0.95 }，noul 就是 P(yes)
    thirdParty: readNoul(answers.third_party),
    identityLinkable: readNoul(answers.identity_linkable),
    // Choice：{ type: "choice", choice: "health", probabilities, confidence }
    sensitiveCategory: readChoice(answers.sensitive_category),
    // Score：{ type: "score", score: 1.6, legend, probabilities, confidence }，可以落在两级之间
    reviewWorthiness: readScore(answers.review_worthiness),
    source: "jev",
    raw: json
  }

  const usage = readUsage(json.usage)
  if (usage) result.tokenUsage = usage
  return result
}

function readNoul(answer: unknown): number {
  if (!isRecord(answer) || answer.type !== "noul") throw new JevError("bad-response")
  const p = answer.noul
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) throw new JevError("bad-response")
  return p
}

function readChoice(answer: unknown): string {
  if (!isRecord(answer) || answer.type !== "choice") throw new JevError("bad-response")
  const c = answer.choice
  if (typeof c !== "string" || !c) throw new JevError("bad-response")
  return c
}

function readScore(answer: unknown): number {
  if (!isRecord(answer) || answer.type !== "score") throw new JevError("bad-response")
  const s = answer.score
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 3) throw new JevError("bad-response")
  return s
}

export function readUsage(usage: unknown): TokenUsage | undefined {
  if (!isRecord(usage)) return undefined
  const input = usage.input_tokens
  const output = usage.output_tokens
  if (typeof input !== "number" || typeof output !== "number") return undefined
  return { input, output }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
