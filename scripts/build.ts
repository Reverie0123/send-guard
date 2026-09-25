/**
 * 构建扩展到 packages/extension/dist/，Chrome / Edge 直接「加载已解压的扩展程序」选这个目录。
 *   - esbuild 把 background / content / popup 分别打成独立 IIFE（content script 不支持 ES module）
 *   - 复制 manifest.json、popup.html、icon.svg
 *   - 生成 16/32/48/128 PNG 图标（manifest 的 icons 不支持 SVG）
 */
import { build } from "esbuild"
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const EXT = join(ROOT, "packages/extension")
const DIST = join(EXT, "dist")

rmSync(DIST, { recursive: true, force: true })
mkdirSync(join(DIST, "icons"), { recursive: true })

await build({
  entryPoints: {
    background: join(EXT, "src/background.ts"),
    content: join(EXT, "src/content.ts"),
    popup: join(EXT, "src/popup.ts")
  },
  outdir: DIST,
  bundle: true,
  format: "iife",
  target: "chrome102",
  charset: "utf8",
  legalComments: "none",
  logLevel: "info"
})

copyFileSync(join(EXT, "manifest.json"), join(DIST, "manifest.json"))
copyFileSync(join(EXT, "src/popup.html"), join(DIST, "popup.html"))
copyFileSync(join(EXT, "icons/icon.svg"), join(DIST, "icons/icon.svg"))
cpSync(join(EXT, "_locales"), join(DIST, "_locales"), { recursive: true })

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(DIST, `icons/icon-${size}.png`), renderIcon(size))
}
console.log(`扩展已构建到 ${DIST}`)

// ---------- 与 icon.svg 同款的程序化 PNG（蓝底白盾），不依赖任何图像库 ----------

function renderIcon(size: number): Buffer {
  const SS = 4 // 4x4 超采样抗锯齿
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0
      let shield = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // 归一化到 128 坐标系，与 SVG viewBox 一致
          const u = ((x + (sx + 0.5) / SS) / size) * 128
          const v = ((y + (sy + 0.5) / SS) / size) * 128
          if (inRoundedRect(u, v, 128, 28)) {
            bg++
            if (inShield(u, v)) shield++
          }
        }
      }
      const n = SS * SS
      const a = bg / n
      const s = bg ? shield / bg : 0
      const i = (y * size + x) * 4
      rgba[i] = Math.round(0x2b + (0xff - 0x2b) * s)
      rgba[i + 1] = Math.round(0x6c + (0xff - 0x6c) * s)
      rgba[i + 2] = Math.round(0xb0 + (0xff - 0xb0) * s)
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  return encodePng(size, size, rgba)
}

function inRoundedRect(u: number, v: number, s: number, r: number): boolean {
  const cx = Math.min(Math.max(u, r), s - r)
  const cy = Math.min(Math.max(v, r), s - r)
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r
}

function inShield(u: number, v: number): boolean {
  if (v < 22 || v > 108) return false
  // 顶部斜边：中心 (64,22) 到两侧 (28/100, 34)
  const top = 22 + (Math.abs(u - 64) / 36) * 12
  if (v < top) return false
  if (v <= 62) return u >= 28 && u <= 100
  // 下半部收窄到底部尖点 (64,108)
  const half = 36 * Math.sqrt(Math.max(0, 1 - ((v - 62) / 46) ** 2))
  return Math.abs(u - 64) <= half
}

function encodePng(w: number, h: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
