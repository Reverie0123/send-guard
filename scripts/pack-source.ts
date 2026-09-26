/**
 * 打包源码：release-artifacts/send-guard-src-v{版本}.zip。
 * 用 git archive，只包含已提交到 Git 的文件，不含 node_modules、.git、dist 和本地产物，
 * 发给别人或上传项目包时用这个，对方解压后 `npm ci` 即可。未提交的改动不会进包。
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version
const outDir = join(ROOT, "release-artifacts")
mkdirSync(outDir, { recursive: true })
const out = join(outDir, `send-guard-src-v${version}.zip`)

const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim()
if (dirty) console.warn("注意：有未提交的改动，它们不会被打包")

execFileSync("git", ["archive", "--format=zip", `--prefix=send-guard/`, "-o", out, "HEAD"], { cwd: ROOT, stdio: "inherit" })
console.log(`已生成 ${out}`)
