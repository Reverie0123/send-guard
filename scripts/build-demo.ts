/**
 * 构建在线演示用的扩展脚本：docs/demo/content-gmail.js、content-discord.js。
 * 就是扩展里真实的 content.ts，只把网站域名（和 Discord 的频道路径）固定下来，
 * 让演示页走对应网站的适配器。后台调用由 docs/demo/demo-stub.js 用预先生成的结果代替。
 */
import { build } from "esbuild"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const targets: { out: string; define: Record<string, string> }[] = [
  { out: "content-gmail.js", define: { "location.hostname": '"mail.google.com"' } },
  // 服务器频道路径 → 适配器识别为群聊
  { out: "content-discord.js", define: { "location.hostname": '"discord.com"', "location.pathname": '"/channels/demo/class-chat"' } }
]

for (const t of targets) {
  await build({
    entryPoints: [join(ROOT, "packages/extension/src/content.ts")],
    outfile: join(ROOT, "docs/demo", t.out),
    bundle: true,
    format: "iife",
    target: "chrome102",
    charset: "utf8",
    legalComments: "none",
    minify: true,
    define: t.define,
    logLevel: "warning"
  })
  console.log(`已生成 docs/demo/${t.out}`)
}
