/**
 * 用真实接口跑校准样本（tests/calibration/cases.json），统计漏报 / 误报。
 * 改提示词或阈值后跑一次；会产生少量费用（DeepSeek 一轮约 ¥0.1），所以不放进 release 流程。
 *
 *   npm run calibrate                 # 默认 DeepSeek，key 读环境变量 DEEPSEEK_API_KEY
 *   npm run calibrate -- openrouter   # key 读 OPENROUTER_API_KEY
 *
 * key 只从环境变量读取，不打印、不写文件。有漏报或误报时非零退出。
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { analyzeWithLlm, getAlertLevel, localGate, type LlmProvider } from "../packages/core/src/index"

type Case = { id: string; expect: "warn" | "none" | "edge"; rc: string; text: string }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const provider = (process.argv[2] ?? "deepseek") as LlmProvider
const envName = provider === "openrouter" ? "OPENROUTER_API_KEY" : "DEEPSEEK_API_KEY"
const key = process.env[envName]
if (!key) {
  console.error(`缺少环境变量 ${envName}`)
  process.exit(2)
}

const cases: Case[] = JSON.parse(readFileSync(join(ROOT, "tests/calibration/cases.json"), "utf8"))

interface Row { c: Case; gate: string; rw?: number; level?: string; flagged: boolean; error?: string }
const rows: Row[] = []
let inTok = 0
let outTok = 0

const queue = [...cases]
async function worker(): Promise<void> {
  for (let c = queue.shift(); c; c = queue.shift()) {
    const gate = localGate(c.text)
    try {
      const r = await analyzeWithLlm(provider, { text: c.text, recipientContext: c.rc || undefined }, key!)
      inTok += r.tokenUsage?.input ?? 0
      outTok += r.tokenUsage?.output ?? 0
      const level = getAlertLevel(r)
      rows.push({ c, gate: gate.check ? gate.reason : `本地放行:${gate.reason}`, rw: r.reviewWorthiness, level, flagged: gate.check && level !== "none" })
    } catch (e) {
      rows.push({ c, gate: gate.reason, flagged: false, error: String((e as Error).message) })
    }
  }
}
await Promise.all(Array.from({ length: 5 }, worker))
rows.sort((a, b) => a.c.id.localeCompare(b.c.id))

const missed = rows.filter(r => r.c.expect === "warn" && !r.flagged)
const falsePos = rows.filter(r => r.c.expect === "none" && r.flagged)
const errors = rows.filter(r => r.error)
const edgeFlagged = rows.filter(r => r.c.expect === "edge" && r.flagged)

const show = (r: Row) => `  ${r.c.id} [${r.c.rc || "无上下文"}] ${r.c.text} → ${r.error ?? `${r.gate} rw=${r.rw} ${r.level}`}`
if (missed.length) console.log(`漏报 ${missed.length}：\n${missed.map(show).join("\n")}`)
if (falsePos.length) console.log(`误报 ${falsePos.length}：\n${falsePos.map(show).join("\n")}`)
if (errors.length) console.log(`请求失败 ${errors.length}：\n${errors.map(show).join("\n")}`)
if (edgeFlagged.length) console.log(`边界样本被提醒 ${edgeFlagged.length}（仅供参考）：\n${edgeFlagged.map(show).join("\n")}`)

const count = (e: Case["expect"]) => rows.filter(r => r.c.expect === e).length
const warnRw = rows.filter(r => r.c.expect === "warn" && r.rw !== undefined).map(r => r.rw!)
const noneRw = rows.filter(r => r.c.expect === "none" && r.rw !== undefined).map(r => r.rw!)
console.log(`\n${provider}：该提醒 ${count("warn") - missed.length}/${count("warn")}，不该提醒误报 ${falsePos.length}/${count("none")}，边界提醒 ${edgeFlagged.length}/${count("edge")}`)
console.log(`复核建议分布：该提醒最低 ${Math.min(...warnRw)}，不该提醒最高 ${Math.max(...noneRw)}`)
console.log(`tokens：input ${inTok} / output ${outTok}`)

process.exit(missed.length || falsePos.length || errors.length ? 1 : 0)
