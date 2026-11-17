/**
 * G7 密码哈希单元测试（node:crypto scrypt，无 DB）。
 */
import { describe, expect, it } from 'vitest'
import {
  generateInitialPassword,
  hashPassword,
  verifyPassword,
} from '../lib/auth/password.js'

describe('scrypt 密码哈希', () => {
  it('哈希格式 scrypt$N$r$p$salt$hash，且不含明文', async () => {
    const password = 'Auth-pass-单元-123'
    const hash = await hashPassword(password)
    const parts = hash.split('$')
    expect(parts).toHaveLength(6)
    expect(parts[0]).toBe('scrypt')
    expect(hash).not.toContain(password)
  })

  it('正确密码校验通过；错误密码不通过', async () => {
    const hash = await hashPassword('correct-password')
    expect(await verifyPassword('correct-password', hash)).toBe(true)
    expect(await verifyPassword('Correct-password', hash)).toBe(false)
    expect(await verifyPassword('correct-password ', hash)).toBe(false)
  })

  it('同一密码两次哈希不同（随机盐）', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')])
    expect(a).not.toBe(b)
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  })

  it('非法/损坏的存储值一律 false，不抛错', async () => {
    for (const bad of ['', 'plaintext', 'scrypt$1$2$3', 'scrypt$0$0$0$xx$yy', 'bcrypt$1$2$3$4$5']) {
      expect(await verifyPassword('whatever', bad)).toBe(false)
    }
  })

  it('随机初始密码长度 12、字符集为 base64url', () => {
    const pwd = generateInitialPassword()
    expect(pwd).toHaveLength(12)
    expect(pwd).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(generateInitialPassword()).not.toBe(pwd)
  })
})
