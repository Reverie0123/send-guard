import { buildQuestions, buildState, isRecord, JevError } from "./jev"
import { SENSITIVE_CATEGORIES, type AnalyzeInput, type JevResult } from "./types"

/**
 * 通用大模型后端（OpenAI 兼容接口）：在拿到 TypeSafe Jev key 之前的临时替代。
 * 用同一组问题（buildQuestions）让模型输出 JSON，映射成 JevResult，面板 / 阈值 / 文案全部复用。
 * 注意：模型自报的概率未经校准，精度不如 Jev。UI 文案仍由 templates.ts 固定生成，不让模型写解释。
 * 只用标准 fetch，无任何 chrome.* 或 Node.js API。
 */

export type LlmProvider = "deepseek" | "openrouter"

export interface LlmPreset {
  label: string
  endpoint: string
  defaultModel: string
  /** 请求体里除 model / messages 之外的服务商特有参数 */
  extraBody: Record<string, unknown>
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    third_party: { type: "number" },
    identity_linkable: { type: "number" },
    sensitive_category: { type: "string", enum: [...SENSITIVE_CATEGORIES] },
    review_worthiness: { type: "number" }
  },
  required: ["third_party", "identity_linkable", "sensitive_category", "review_worthiness"],
  additionalProperties: false
}

export const LLM_PRESETS: Record<LlmProvider, LlmPreset> = {
  // https://api-docs.deepseek.com/zh-cn/ （2026-09-25 核对：deepseek-flash = V4.1-Flash，JSON Output 用 json_object）
  deepseek: {
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-flash",
    extraBody: {
      response_format: { type: "json_object" },
      thinking: { type: "disabled" } // 默认是思考模式，关掉以降低延迟和费用
    }
  },
  // https://openrouter.ai/docs （json_schema 结构化输出；只路由到支持该参数、且不留存数据的服务商）
  openrouter: {
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "deepseek/deepseek-v4.1-flash",
    extraBody: {
      response_format: {
        type: "json_schema",
        json_schema: { name: "privacy_check", strict: true, schema: RESPONSE_SCHEMA }
      },
      provider: { require_parameters: true, data_collection: "deny" },
      usage: { include: true }
    }
  }
}

const REQUEST_TIMEOUT_MS = 20_000

/** 把 Jev 风格的问题定义翻译成给大模型的说明，保证两类后端问的是同一件事 */
export function buildLlmPrompt(): string {
  const q = buildQuestions()
  const categories = Object.entries(q.sensitive_category.criteria)
    .map(([k, v]) => `  - "${k}": ${v}`)
    .join("\n")
  const levels = q.review_worthiness.criteria.map((c, i) => `  ${i}: ${c}`).join("\n")
  return [
    "You are a privacy-risk classifier that runs right before a user sends a message.",
    "Read the state (message, recipient, relationship, platform) and answer four questions.",
    "",
    `third_party (probability 0-1 that the answer is yes): ${q.third_party.instructions}`,
    `identity_linkable (probability 0-1 that the answer is yes): ${q.identity_linkable.instructions}`,
    `sensitive_category (pick exactly one key): ${q.sensitive_category.instructions}`,
    categories,
    `review_worthiness (number 0-3, may be fractional): ${q.review_worthiness.instructions}`,
    levels,
    "",
    "Calibrate honestly: ordinary messages about the sender's own life or routine work should get low values.",
    "Sarcasm, irony, mock congratulations, nicknames in quotes and vague references (\"someone\", \"that person\") still count:",
    "judge the private fact being implied (e.g. a failed exam, a breakup, a layoff) and whether the audience can tell who it is.",
    "Group chats and channels widen the audience and raise the risk; saying something to the person it is about does not disclose it to anyone else.",
    "Good news or neutral work facts about others are usually fine.",
    "Output only a json object, no explanation. Example json output:",
    '{"third_party": 0.12, "identity_linkable": 0.05, "sensitive_category": "none", "review_worthiness": 0.3}'
  ].join("\n")
}

export async function analyzeWithLlm(
  provider: LlmProvider,
  input: AnalyzeInput,
  apiKey: string,
  model?: string
): Promise<JevResult> {
  if (!apiKey) throw new JevError("no-key")
  const preset = LLM_PRESETS[provider]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(preset.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || preset.defaultModel,
        temperature: 0,
        max_tokens: 200,
        stream: false,
        messages: [
          { role: "system", content: buildLlmPrompt() },
          { role: "user", content: buildState(input) }
        ],
        ...preset.extraBody
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
  return parseLlmResponse(provider, json)
}

/** OpenAI 兼容响应 → JevResult。格式不对（含空 content）一律抛错，按「检查未完成」处理。 */
export function parseLlmResponse(provider: LlmProvider, json: unknown): JevResult {
  if (!isRecord(json) || !Array.isArray(json.choices)) throw new JevError("bad-response")
  const message = isRecord(json.choices[0]) ? json.choices[0].message : undefined
  const content = isRecord(message) ? message.content : undefined
  if (typeof content !== "string" || !content.trim()) throw new JevError("bad-response")

  let answers: unknown
  try {
    // 个别模型会包一层 ```json 代码块
    answers = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""))
  } catch {
    throw new JevError("bad-response")
  }
  if (!isRecord(answers)) throw new JevError("bad-response")

  const category = answers.sensitive_category
  if (typeof category !== "string" || !(SENSITIVE_CATEGORIES as readonly string[]).includes(category)) {
    throw new JevError("bad-response")
  }

  const result: JevResult = {
    thirdParty: readRange(answers.third_party, 1),
    identityLinkable: readRange(answers.identity_linkable, 1),
    sensitiveCategory: category,
    reviewWorthiness: readRange(answers.review_worthiness, 3),
    source: provider,
    raw: json
  }

  const usage = json.usage
  if (isRecord(usage)) {
    if (typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number") {
      result.tokenUsage = { input: usage.prompt_tokens, output: usage.completion_tokens }
    }
    // OpenRouter 在 usage.cost 返回实际扣费（美元）；DeepSeek 不返回
    if (typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) {
      result.costUsd = usage.cost
    }
  }
  return result
}

function readRange(v: unknown, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) throw new JevError("bad-response")
  return v
}
