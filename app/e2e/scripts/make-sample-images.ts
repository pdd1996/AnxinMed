/**
 * 处方笺样张占位生成器（M6 隐私口径）。
 *
 * 背景：`app/fixtures/rx-*.png` 是**合成**处方笺样张，但含医院名与合成 PII，按用户要求
 * 不再进仓库（`.gitignore` 已排除）。CI 的 E2E 走 fixture 回放，**不读像素**——只需一个
 * 合法 PNG 供 `setInputFiles` 上传走过质量预检（一律按「仍要上传」放行），故此处生成纯色占位图，
 * 不依赖 Pillow / 中文字体。
 *
 * 要给人看 / 给 `test:e2e:live` 真实 OCR 用的**带字**样张，仍走 `python app/fixtures/make-fixtures.py`
 * （微软雅黑渲染，见 app/fixtures/README.md）；本脚本只在文件缺失时补占位图，**不覆盖已存在的样张**。
 *
 * 运行：pnpm --filter @anxin/e2e make-sample-images
 * 接入：e2e/global-setup.ts 在库准备前调用（本地与远端模式都会补图）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface Spec {
  scenarios: Record<string, { image: string; entry: 'A' | 'B' }>
}

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const SPEC_PATH = fileURLToPath(new URL('../../fixtures/golden-cases.json', import.meta.url))

// 与 app/fixtures/make-fixtures.py 的 W/H 保持一致（~A4 @150dpi），避免占位图与原图尺寸语义漂移
const W = 1240
const H = 1754
// 浅灰底：亮度不进暗图判据；纯色必命中「模糊」判据 → 依赖 E2E 的「仍要上传」放行（与真实样张同路径）
const FILL: [number, number, number] = [235, 235, 235]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** 最小 PNG 编码器（8bit RGB、无滤波）：不引第三方依赖，CI 无需 Pillow。 */
function makePng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor

  const rowLen = width * 3 + 1 // 每行首字节为 filter type 0
  const raw = Buffer.alloc(rowLen * height)
  for (let y = 0; y < height; y++) {
    const row = y * rowLen
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 仅在缺失时补占位图；已存在的（脚本渲染的带字样张）一律不动。返回本次新建的文件名。 */
export function ensureSampleImages(): string[] {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf-8')) as Spec
  const made: string[] = []
  for (const [name, sc] of Object.entries(spec.scenarios)) {
    // 只补处方笺（entry A）；药盒/散装样张仍在仓库内，缺失即真异常，不静默造图掩盖
    if (sc.entry !== 'A') continue
    const out = `${FIXTURES_DIR}${sc.image}`
    if (existsSync(out)) continue
    writeFileSync(out, makePng(W, H, FILL))
    made.push(`${name} -> fixtures/${sc.image}`)
  }
  return made
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const made = ensureSampleImages()
  console.log(made.length ? `[ok] 补占位样张：\n${made.map((m) => `  - ${m}`).join('\n')}` : '[ok] 处方笺样张齐全，无需补图')
}
