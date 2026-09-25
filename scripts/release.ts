/**
 * 一键发布。顺序固定，任何一步失败立即非零退出，不推送：
 *   1. version:sync 并校验三处版本号一致
 *   2. tsc 类型检查
 *   （git 操作前的安全检查：CHANGELOG 有本版本记录、README 写了当前版本、在 main 分支、tag 未被占用）
 *   3. git add -A
 *   4. git commit -m "release: v{version} - {CHANGELOG 本次版本第一条描述}"
 *   5. git tag v{version}（附注 tag，否则 --follow-tags 不会推送它）
 *   6. git push origin main --follow-tags
 * commit 作者沿用本机 git config，脚本不覆盖。
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const isWindows = process.platform === "win32"

function step(label: string, cmd: string, args: string[]): void {
  console.log(`\n▶ ${label}: ${cmd} ${args.join(" ")}`)
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: isWindows && cmd === "npm" })
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
}

function readJsonVersion(rel: string): unknown {
  return (JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as { version?: unknown }).version
}

function fail(msg: string): never {
  throw new Error(msg)
}

function changelogFirstEntry(version: string): string {
  const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")
  const lines = text.split(/\r?\n/)
  const escaped = version.replace(/\./g, "\\.")
  const start = lines.findIndex(l => new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`).test(l))
  if (start < 0) fail(`CHANGELOG.md 中没有 "## [${version}] - YYYY-MM-DD" 记录`)
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break
    const m = /^-\s+(.+)$/.exec(line.trim())
    if (m) return m[1]!.replace(/[（(]影响范围[:：][^）)]*[）)]\s*$/, "").trim()
  }
  fail(`CHANGELOG.md 的 [${version}] 下没有任何条目`)
}

function main(): void {
  // 1. 版本号同步
  step("1/6 同步版本号", "npm", ["run", "version:sync"])
  const version = readJsonVersion("package.json")
  if (typeof version !== "string") fail("根 package.json 缺少 version")
  for (const rel of ["packages/extension/manifest.json", "packages/extension/package.json"]) {
    if (readJsonVersion(rel) !== version) fail(`${rel} 的版本号与根目录不一致`)
  }

  // 2. 编译检查
  step("2/6 tsc 编译检查", "npm", ["run", "typecheck"])

  // git 操作前的安全检查
  const summary = changelogFirstEntry(version)
  if (!readFileSync(join(ROOT, "README.md"), "utf8").includes(`v${version}`)) {
    fail(`README.md 没有写当前版本 v${version}`)
  }
  const branch = git(["symbolic-ref", "--short", "HEAD"])
  if (branch !== "main") fail(`当前分支是 ${branch}，只允许在 main 上发布`)
  if (git(["tag", "-l", `v${version}`])) fail(`tag v${version} 已存在，请先升版本号`)

  // 3–6. 提交、打 tag、推送
  step("3/6 暂存", "git", ["add", "-A"])
  step("4/6 提交", "git", ["commit", "-m", `release: v${version} - ${summary}`])
  step("5/6 打 tag", "git", ["tag", "-a", `v${version}`, "-m", `v${version}`])
  step("6/6 推送", "git", ["push", "origin", "main", "--follow-tags"])

  console.log(`\n✔ v${version} 已发布`)
}

try {
  main()
} catch (e) {
  console.error(`\n✖ 发布中止：${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
