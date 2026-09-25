/**
 * 从根 package.json 读取唯一版本号，写入：
 *   - packages/extension/manifest.json
 *   - packages/extension/package.json
 * 写完后回读校验三处一致，不一致则非零退出。
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const TARGETS = [
  "packages/extension/manifest.json",
  "packages/extension/package.json"
]

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as Record<string, unknown>
}

function rootVersion(): string {
  const v = readJson("package.json").version
  if (typeof v !== "string" || !/^\d+\.\d+\.\d+$/.test(v)) {
    throw new Error(`根 package.json 的 version 不是合法的 x.y.z：${String(v)}`)
  }
  return v
}

function syncVersions(): string {
  const version = rootVersion()
  for (const rel of TARGETS) {
    const json = readJson(rel)
    if (json.version !== version) {
      json.version = version
      writeFileSync(join(ROOT, rel), `${JSON.stringify(json, null, 2)}\n`)
      console.log(`  ${rel} → ${version}`)
    }
  }
  const mismatched = TARGETS.filter(rel => readJson(rel).version !== version)
  if (mismatched.length) throw new Error(`版本号同步失败：${mismatched.join(", ")}`)
  console.log(`版本号已同步：${version}（package.json / ${TARGETS.join(" / ")}）`)
  return version
}

try {
  syncVersions()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
