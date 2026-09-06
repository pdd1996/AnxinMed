/**
 * E2E fixture 回放包生成器（M2-T10）—— 把 app/fixtures/golden-cases.json 编译为 app/e2e/fixtures/<scenario>.json。
 *
 * 每个包冻结该场景的模型逐步原始响应（detectLayers / runOcr / extractIdentity / fallbackParse），
 * 供 api 的 FixtureAiClients（AI_MODE=fixtures）按 x-test-scenario 回放 —— CI 无 key 可复现。
 *
 * 为什么合成即 oracle：golden case 的处方文本/涂黑/冲突/标签/散装形态是**人工设计并审核**的地面真相
 * （见 fixtures/README.md），mock OCR 的字符级坐标按与单测一致的布局约定渲染；故无需真实模型即可冻结 I/O。
 * 有 key 环境换 prompt/换模型版本时，用 AI_MODE=record 的录制路径重录并重审（source 标 live）。
 *
 * 运行：pnpm --filter @anxin/e2e make-fixtures
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { OcrChar, OcrResult } from '../../packages/api/src/lib/ai/types.js'

interface Scenario {
  image: string
  entry: 'A' | 'B'
  layers: string[]
  lines: string[]
  redact?: number[]
  identity?: Record<string, unknown>
  fallback?: Record<string, string>
}
interface Spec {
  drug: { identity: Record<string, unknown> }
  scenarios: Record<string, Scenario>
}

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SPEC_PATH = fileURLToPath(new URL('../../fixtures/golden-cases.json', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('../fixtures', import.meta.url))

/** 与单测 helpers/ai-mocks.mkOcr 同布局：行 y=行号×30，字符宽 16 高 20，行内 x 从 10 递增。 */
function mkOcr(lines: string[], confidence = 0.99): OcrResult {
  const chars: OcrChar[] = []
  lines.forEach((line, li) => {
    const y = li * 30
    let x = 10
    for (const ch of line) {
      chars.push({ text: ch, confidence, box: { x, y, w: 16, h: 20 } })
      x += 16
    }
  })
  return { chars }
}

function ocrLines(sc: Scenario): string[] {
  const redact = new Set(sc.redact ?? [])
  return sc.lines.filter((_, i) => !redact.has(i))
}

function main() {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf-8')) as Spec
  mkdirSync(OUT_DIR, { recursive: true })
  for (const [name, sc] of Object.entries(spec.scenarios)) {
    const isRx = sc.entry === 'A'
    const pack = {
      scenario: name,
      entry: sc.entry,
      source: 'synthetic',
      detectLayers: sc.layers,
      // 入口B 身份线；散装药片在层检测即 422，身份永不提取 → null
      extractIdentity: name === 'unsupported-loose-pills' ? null : (sc.identity ?? spec.drug.identity),
      // 仅入口A 跑 OCR；涂黑行已从 OCR 可见文本中剔除
      runOcr: isRx ? mkOcr(ocrLines(sc)) : null,
      fallbackParse: sc.fallback ? Object.fromEntries(Object.entries(sc.fallback).filter(([k]) => k !== '_note')) : null,
    }
    const out = `${OUT_DIR}/${name}.json`
    writeFileSync(out, JSON.stringify(pack, null, 2), 'utf-8')
    console.log(`[ok] ${name} -> e2e/fixtures/${name}.json (entry=${sc.entry}, ocr=${isRx ? ocrLines(sc).length + ' lines' : 'n/a'})`)
  }
  console.log(`\n共生成 ${Object.keys(spec.scenarios).length} 个 fixture 包于 ${OUT_DIR}`)
}

main()
