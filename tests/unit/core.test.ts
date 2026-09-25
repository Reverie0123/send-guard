import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  audienceFromCount,
  buildState,
  describeAudienceZh,
  isAudience,
  getAlertLevel,
  getRiskSummary,
  JevError,
  localGate,
  parseJevResponse,
  parseLlmResponse,
  providerNote,
  type JevResultPublic
} from "../../packages/core/src/index"

const score = (p: Partial<JevResultPublic>): JevResultPublic => ({
  thirdParty: 0, identityLinkable: 0, sensitiveCategory: "none", reviewWorthiness: 0, ...p
})

describe("localGate 本地预筛", () => {
  it("客套短回复不上传", () => {
    for (const t of ["好的", "收到！", "哈哈哈", "ok", "谢谢", "晚安~"]) assert.equal(localGate(t).check, false, t)
  })
  it("不涉及他人的短句不上传", () => {
    for (const t of ["今天好累啊", "晚上吃火锅不", "周末一起去爬山吗？天气预报说是晴天"]) {
      assert.deepEqual(localGate(t), { check: false, reason: "short" }, t)
    }
  })
  it("短句提到他人 / 敏感事件 / 号码要检查", () => {
    for (const t of ["我朋友小李今天在学校被打了", "小张确诊了", "我同桌有艾滋", "她是同性恋", "老王被开除了", "住3栋2单元"]) {
      assert.equal(localGate(t).check, true, t)
    }
  })
  it("≥ 20 字一律检查", () => {
    assert.deepEqual(localGate("这是一条足够长的普通消息，用来测试长度超过二十个字的情况"), { check: true, reason: "long" })
  })
  it("空内容", () => assert.deepEqual(localGate("   "), { check: false, reason: "empty" }))
})

describe("判定规则", () => {
  it("Jev：第三方隐私 ≥ 0.8 单独即可提醒（沿用原规则）", () => {
    assert.equal(getAlertLevel(score({ thirdParty: 0.9, reviewWorthiness: 1, source: "jev" })), "warn")
  })
  it("Jev：红色条件", () => {
    assert.equal(getAlertLevel(score({ thirdParty: 0.9, identityLinkable: 0.85 })), "red")
    assert.equal(getAlertLevel(score({ reviewWorthiness: 2.8 })), "red")
  })
  it("Jev：类别本身不触发提醒", () => {
    assert.equal(getAlertLevel(score({ sensitiveCategory: "health", reviewWorthiness: 1.2 })), "none")
  })
  it("通用模型：只看复核建议，提到别人不单独触发", () => {
    const base = { thirdParty: 0.9, identityLinkable: 0.7, sensitiveCategory: "professional", source: "deepseek" as const }
    assert.equal(getAlertLevel(score({ ...base, reviewWorthiness: 2.0 })), "none")
    assert.equal(getAlertLevel(score({ ...base, reviewWorthiness: 2.1 })), "warn")
    assert.equal(getAlertLevel(score({ ...base, reviewWorthiness: 2.8 })), "red")
    assert.equal(getAlertLevel(score({ ...base, identityLinkable: 0.85, reviewWorthiness: 2.2 })), "red")
  })
  it("通用模型判定不提醒时，摘要不能自相矛盾", () => {
    assert.equal(getRiskSummary(score({ thirdParty: 0.9, reviewWorthiness: 1.2, source: "openrouter" })), "未检测到明显风险")
  })
  it("非 Jev 结果带说明", () => {
    assert.match(providerNote("deepseek"), /未经校准/)
    assert.equal(providerNote("jev"), "")
  })
})

describe("Jev 响应解析（docs.typesafe.ai/api 格式）", () => {
  const ok = {
    model: "jev-1.13.0",
    answers: {
      third_party: { type: "noul", noul: 0.87 },
      identity_linkable: { type: "noul", noul: 0.74 },
      sensitive_category: { type: "choice", choice: "relationship", probabilities: {}, confidence: 0.8 },
      review_worthiness: { type: "score", score: 2.6, legend: {}, probabilities: {}, confidence: 0.7 }
    },
    usage: { input_tokens: 296, output_tokens: 20 }
  }
  it("正常解析", () => {
    const r = parseJevResponse(ok)
    assert.equal(r.thirdParty, 0.87)
    assert.equal(r.reviewWorthiness, 2.6)
    assert.equal(r.source, "jev")
    assert.deepEqual(r.tokenUsage, { input: 296, output: 20 })
  })
  it("旧的猜测格式被拒绝（fail-closed）", () => {
    assert.throws(() => parseJevResponse({ answers: { third_party: { answer: true, probability: 0.8 } } }), JevError)
  })
})

describe("通用模型响应解析", () => {
  const wrap = (content: string, usage: object = { prompt_tokens: 400, completion_tokens: 30 }) =>
    ({ choices: [{ message: { content } }], usage })
  it("正常 JSON 与代码块包裹", () => {
    const body = '{"third_party":0.9,"identity_linkable":0.8,"sensitive_category":"health","review_worthiness":2.7}'
    assert.equal(parseLlmResponse("deepseek", wrap(body)).reviewWorthiness, 2.7)
    assert.equal(parseLlmResponse("deepseek", wrap("```json\n" + body + "\n```")).sensitiveCategory, "health")
  })
  it("OpenRouter 返回实际费用", () => {
    const body = '{"third_party":0.1,"identity_linkable":0.1,"sensitive_category":"none","review_worthiness":0.2}'
    assert.equal(parseLlmResponse("openrouter", wrap(body, { prompt_tokens: 1, completion_tokens: 1, cost: 0.00006 })).costUsd, 0.00006)
  })
  it("空内容 / 非 JSON / 越界 / 未知类别一律抛错", () => {
    for (const c of ["", "I think it is risky",
      '{"third_party":1.4,"identity_linkable":0.1,"sensitive_category":"none","review_worthiness":1}',
      '{"third_party":0.4,"identity_linkable":0.1,"sensitive_category":"politics","review_worthiness":1}']) {
      assert.throws(() => parseLlmResponse("deepseek", wrap(c)), JevError, c)
    }
  })
})

describe("发送对象（粗粒度）", () => {
  it("人数 → 区间", () => {
    assert.equal(audienceFromCount(0), undefined)
    assert.deepEqual(audienceFromCount(1), { kind: "direct" })
    assert.deepEqual(audienceFromCount(3), { kind: "group", size: "small" })
    assert.deepEqual(audienceFromCount(30), { kind: "group", size: "medium" })
    assert.deepEqual(audienceFromCount(200), { kind: "group", size: "large" })
  })
  it("只接受合法取值", () => {
    assert.equal(isAudience({ kind: "group", size: "small" }), true)
    assert.equal(isAudience({ kind: "group", size: "huge" }), false)
    assert.equal(isAudience({ kind: "everyone" }), false)
    assert.equal(isAudience("group"), false)
  })
  it("写进 state，且不含任何具体身份", () => {
    const state = buildState({ text: "hi", audience: { kind: "group", size: "medium" } })
    assert.match(state, /Audience: group chat .*11-50 people/)
    assert.match(buildState({ text: "hi", audience: { kind: "direct" } }), /Audience: direct message to one person/)
  })
  it("面板文案", () => {
    assert.equal(describeAudienceZh(undefined), "未识别（用默认上下文）")
    assert.match(describeAudienceZh({ kind: "group", size: "large" }), /50 人以上/)
  })
})

describe("buildState", () => {
  it("未填收件人时注明 unknown", () => {
    assert.match(buildState({ text: "hi" }), /Recipient: unknown/)
  })
  it("超长文本截断到 1000 字", () => {
    assert.equal(buildState({ text: "字".repeat(1500) }).split("\n")[0]!.length, "Message: ".length + 1000)
  })
})
