/**
 * G7 密码哈希（过渡实现）—— node:crypto scrypt，零新依赖。
 *
 * 存储格式：`scrypt$N$r$p$<salt base64url>$<hash base64url>`
 * 参数：N=16384, r=8, p=1（约 16MB 内存/次；staging demo 规模足够，登录限流兜底）。
 *
 * 纪律：
 * - 每个密码独立随机盐；比对必须 timingSafeEqual（不按字节短路）；
 * - 解析失败按「不匹配」返回 false（不把内部格式错误抛给调用方，也不因此报 500）；
 * - 明文密码绝不落库、绝不进日志。
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 16_384
const R = 8
const P = 1
const KEYLEN = 64
/** scrypt 128*N*r≈16MB，默认 maxmem 32MB 够用；显式给足余量避免环境差异。 */
const MAXMEM = 64 * 1024 * 1024
const SALT_BYTES = 16
const PREFIX = 'scrypt'

function derive(password: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

/** 生成密码哈希（登录开通/重置时调用；每用户独立盐）。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, KEYLEN, N, R, P)
  return [PREFIX, N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/** 校验密码（格式不合法的库值一律 false，不抛错）。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX) return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0 && v <= 1_048_576)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4]!, 'base64url')
    expected = Buffer.from(parts[5]!, 'base64url')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false
  const actual = await derive(password, salt, expected.length, n, r, p)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * 生成随机初始密码（9 字节 base64url ≈ 12 字符 / 72bit 熵）。
 * 仅 CLI 建号/重置时使用；一次性打印给运维，不落库明文。
 */
export function generateInitialPassword(): string {
  return randomBytes(9).toString('base64url')
}
