/**
 * 生成商店截图 store/screenshots/*.png（1280×800），中文 + 英文（*-en）各一套。
 *   - 01、02：store/screenshots 下的静态示例页
 *   - 03：用构建好的真实弹窗（dist/popup.html + popup.js）填入示例数据渲染
 * 用本机 Edge / Chrome 的无头模式截图，使用临时用户目录，不碰你的浏览器配置。先运行 npm run build。
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SHOTS = join(ROOT, "store/screenshots")
const DIST = join(ROOT, "packages/extension/dist")

const BROWSERS = [
  process.env.BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].filter((p): p is string => !!p)
const browser = BROWSERS.find(p => existsSync(p))
if (!browser) {
  console.error("找不到 Edge / Chrome，可用环境变量 BROWSER_PATH 指定")
  process.exit(1)
}

// 03：真实弹窗原样放进 iframe（srcdoc，样式互不干扰），chrome.* 换成示例数据；中英文各一张
const version = (JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8")) as { version: string }).version
const POPUP_TEXT = {
  zh: { lang: "zh-CN", suffix: "", context: "我的同学", words: "身份证, 住院",
    title: "你来决定<br>发给谁检查",
    desc: "用自己的 API key 选择检测服务。自定义敏感词只在本地匹配；发送对象只识别「私聊 / 群聊 + 人数」，不读取任何名字和地址。" },
  en: { lang: "en-US", suffix: "-en", context: "my classmates", words: "passport, hospital",
    title: "You choose<br>who checks it",
    desc: "Bring your own API key. Custom sensitive words are matched only on your device; the audience hint is just direct vs. group and a rough size — no names or addresses." }
}
for (const t of Object.values(POPUP_TEXT)) {
  const stub = `window.chrome = {
  i18n: { getUILanguage: () => "${t.lang}" },
  runtime: { getManifest: () => ({ version: "${version}" }),
    async sendMessage(m) {
      if (m.type === "getPopupState") return {
        hasKey: { jev: false, deepseek: true, openrouter: false }, models: { deepseek: "", openrouter: "" },
        sites: ["https://mail.google.com/*", "https://discord.com/*"],
        settings: { enabled: true, provider: "deepseek", mode: "presend", realtimeConsent: false, recipientContext: "${t.context}", relationship: "friend", sensitiveWords: "${t.words}", autoAudience: true },
        stats: { month: "2026-09", count: 128, input: 58900, output: 4100, jevInput: 0, deepseekInput: 58900, deepseekOutput: 4100, costUsd: 0 } };
      return true } },
  tabs: { async query() { return [{ id: 1, url: "https://discord.com/channels/1/2" }] } },
  permissions: { async request() { return true } }
};`
  const popupDoc = readFileSync(join(DIST, "popup.html"), "utf8")
    .replace('src="icons/icon.svg"', 'src="../../packages/extension/icons/icon.svg"')
    .replace('<script src="popup.js"></script>', () => `<script>${stub}</script><script>${readFileSync(join(DIST, "popup.js"), "utf8")}</script>`)
  // 放进 <script> 里的字符串不能出现 </script>
  const srcdoc = JSON.stringify(popupDoc).replace(/<\//g, "<\\/")
  writeFileSync(join(SHOTS, `03-popup${t.suffix}.html`), `<!doctype html>
<html lang="${t.lang}"><head><meta charset="utf-8"><link rel="stylesheet" href="common.css">
<style>
  .stage { display: flex; justify-content: center; align-items: flex-start; padding-top: 24px; }
  iframe { width: 340px; height: 752px; border: 0; border-radius: 12px; background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,.2); }
</style></head>
<body>
  <div class="caption">
    <img src="../../packages/extension/icons/icon.svg" alt="">
    <h1>${t.title}</h1>
    <p>${t.desc}</p>
  </div>
  <div class="stage"><iframe></iframe></div>
  <script>document.querySelector("iframe").srcdoc = ${srcdoc}</script>
</body></html>`)
}

// [页面, 宽, 高]：截图 1280×800；商店图标 300×300；宣传小图 440×280
const pages: [string, number, number][] = [
  ["01-warning", 1280, 800], ["02-gmail", 1280, 800], ["03-popup", 1280, 800],
  ["01-warning-en", 1280, 800], ["02-gmail-en", 1280, 800], ["03-popup-en", 1280, 800],
  ["logo-300", 300, 300], ["promo-440x280", 440, 280], ["promo-440x280-en", 440, 280]
]
const sleep = (ms: number) => execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`])

for (const [page, width, height] of pages) {
  const out = join(SHOTS, `${page}.png`)
  rmSync(out, { force: true })
  // 每张图用独立的临时用户目录：共用目录时，新启动的实例会把任务交给还没退出的旧实例，导致截图丢失
  const profile = mkdtempSync(join(tmpdir(), "send-guard-shot-"))
  execFileSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "--virtual-time-budget=2000",
    `--screenshot=${out}`, pathToFileURL(join(SHOTS, `${page}.html`)).href
  ], { stdio: "ignore", timeout: 60_000 })
  for (let i = 0; i < 20 && !existsSync(out); i++) sleep(500)
  if (!existsSync(out)) {
    console.error(`截图失败：${page}`)
    process.exit(1)
  }
  console.log(`已生成 ${out}`)
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  } catch {
    // 浏览器子进程可能还占着临时目录，留给系统清理
  }
}
