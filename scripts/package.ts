/**
 * 打包上架用的 zip：release-artifacts/send-guard-v{version}.zip（manifest.json 在 zip 根目录）。
 * 先运行 npm run build。使用系统自带的 tar（Windows 10+ / macOS / Linux 都有）。
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIST = join(ROOT, "packages/extension/dist")
const OUT_DIR = join(ROOT, "release-artifacts")

const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8")) as { version: string }
const rootVersion = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version
if (manifest.version !== rootVersion) {
  console.error(`dist 里的版本 ${manifest.version} 与根 package.json ${rootVersion} 不一致，请先 npm run build`)
  process.exit(1)
}

const files = ["manifest.json", "background.js", "content.js", "popup.js", "popup.html", "icons"]
for (const f of files) {
  if (!existsSync(join(DIST, f))) {
    console.error(`dist 缺少 ${f}，请先 npm run build`)
    process.exit(1)
  }
}

mkdirSync(OUT_DIR, { recursive: true })
const zip = join(OUT_DIR, `send-guard-v${manifest.version}.zip`)
rmSync(zip, { force: true })
// -a：按扩展名自动选择 zip 格式；-C：以 dist 为根，保证 manifest.json 在 zip 根目录
// Windows 上明确用系统自带的 bsdtar：Git Bash 的 GNU tar 会把 "C:" 当成远程主机，也不支持 zip
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
execFileSync(tar, ["-a", "-c", "-f", zip, "-C", DIST, ...files], { stdio: "inherit" })
console.log(`已生成 ${zip}`)
