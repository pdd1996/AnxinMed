/**
 * 统一 env 加载（M12 修复）：本地 `api/.env` 优先，但**空值不遮蔽根 `app/.env`**。
 *
 * 背景：`app/packages/api/.env` 中 QWEN_* 等为空占位，默认 dev 启动时
 * `dotenv/config` 只读该文件 → live 模型被判「缺少配置」→ 静默走降级。
 * 根 `app/.env` 才是本地真实配置来源。
 *
 * 规则：
 * 1. 先读 `app/packages/api/.env`（保留包级覆盖）；
 * 2. 该文件中值为空的键从 process.env 移除（空值 ≠ 配置）；
 * 3. 再读 `app/.env`，只补缺失/为空的键（dotenv 默认不覆盖已有值）；
 * 4. 外部注入的环境变量（CI/生产）始终优先，不被文件覆盖。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const HERE = dirname(fileURLToPath(import.meta.url))
const API_ROOT = join(HERE, '..', '..') // app/packages/api
const APP_ROOT = join(API_ROOT, '..', '..') // app
const LOCAL_ENV = join(API_ROOT, '.env')
const ROOT_ENV = join(APP_ROOT, '.env')

function clearEmptyLocalValues(): void {
  if (!existsSync(LOCAL_ENV)) return
  const text = readFileSync(LOCAL_ENV, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const [, key, rawValue] = m
    if ((rawValue ?? '').trim() === '' && process.env[key] === '') delete process.env[key]
  }
}

if (existsSync(LOCAL_ENV)) {
  config({ path: LOCAL_ENV })
  clearEmptyLocalValues()
}
if (existsSync(ROOT_ENV)) config({ path: ROOT_ENV })
