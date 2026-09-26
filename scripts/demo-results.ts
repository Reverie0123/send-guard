/**
 * 为在线演示预先生成真实的检测结果（docs/demo/results.json）。
 * 每条示例消息 × 三种发送对象（未识别 / 私聊 / 群聊）各调一次 DeepSeek，结果原样保存，演示页不再联网调用模型。
 * key 只从环境变量 DEEPSEEK_API_KEY 读取。示例消息改动后重跑：npm run demo:results
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { analyzeWithLlm, localGate, type Audience, type JevResultPublic } from "../packages/core/src/index"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const key = process.env.DEEPSEEK_API_KEY
if (!key) {
  console.error("缺少环境变量 DEEPSEEK_API_KEY")
  process.exit(2)
}

type Scenario = { id: string; text: string }
const scenarios = JSON.parse(readFileSync(join(ROOT, "docs/demo/scenarios.json"), "utf8")) as Record<string, Scenario[]>
const audiences: (Audience | undefined)[] = [undefined, { kind: "direct" }, { kind: "group", size: "small" }, { kind: "group", size: "unknown" }]

/** 与 docs/demo/demo-stub.js 里的 key 规则保持一致 */
const resultKey = (text: string, a: Audience | undefined) => `${text.trim()}|${a ? `${a.kind}:${a.size ?? ""}` : "none"}`

const out: Record<string, JevResultPublic> = {}
for (const [lang, list] of Object.entries(scenarios)) {
  for (const s of list) {
    if (!localGate(s.text).check) continue // 本地放行的客套话不需要结果
    for (const audience of audiences) {
      const r = await analyzeWithLlm("deepseek", { text: s.text, audience, site: "demo" }, key)
      out[resultKey(s.text, audience)] = {
        thirdParty: r.thirdParty,
        identityLinkable: r.identityLinkable,
        sensitiveCategory: r.sensitiveCategory,
        reviewWorthiness: r.reviewWorthiness,
        source: r.source
      }
      console.log(`${lang} ${s.id} ${audience ? `${audience.kind}:${audience.size ?? ""}` : "none"} → rw=${r.reviewWorthiness}`)
    }
  }
}
writeFileSync(join(ROOT, "docs/demo/results.json"), `${JSON.stringify(out, null, 1)}\n`)
console.log(`已写入 ${Object.keys(out).length} 条结果`)
