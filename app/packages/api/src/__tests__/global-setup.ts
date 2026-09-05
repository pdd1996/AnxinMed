/**
 * Vitest globalSetup —— 独立测试库生命周期（执行总纲 §3.3 / 任务书 T6）。
 *
 * setup：建 anxin_medication_test（若无）→ 跑迁移 → seed users；
 * teardown：drop 测试库（with force），保证每次运行从干净状态开始。
 *
 * 需要 anxin 角色具备 CREATEDB 权限；若无，setup 会明确报错（不静默）。
 */
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { seedUsers } from '../db/seed-users.js'
import { ADMIN_URL, TEST_URL, TEST_DB_NAME } from './test-db-url.js'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export async function setup() {
  // 1. 建测试库（幂等）
  const admin = postgres(ADMIN_URL, { max: 1 })
  try {
    const exists = await admin`select 1 from pg_database where datname = ${TEST_DB_NAME}`
    if (exists.length === 0) {
      await admin.unsafe(`create database ${TEST_DB_NAME}`)
      console.log(`[test-setup] 创建测试库 ${TEST_DB_NAME}`)
    }
  } finally {
    await admin.end()
  }

  // 2. 迁移 + seed（测试库独立，用 mock-data 的确定性 fixture）
  const client = postgres(TEST_URL, { max: 1 })
  const db = drizzle(client)
  await migrate(db, { migrationsFolder })
  const n = await seedUsers(db)
  console.log(`[test-setup] 迁移完成，seed users ${n} 行`)
  await client.end()

  // 3. teardown：drop 测试库
  return async () => {
    const admin2 = postgres(ADMIN_URL, { max: 1 })
    try {
      await admin2.unsafe(`drop database if exists ${TEST_DB_NAME} with (force)`)
      console.log(`[test-teardown] 已清理测试库 ${TEST_DB_NAME}`)
    } finally {
      await admin2.end()
    }
  }
}
