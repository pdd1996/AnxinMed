/**
 * Playwright globalSetup（M2-T10 本地 / M5-T1 远端）—— 测试库生命周期 + golden case 资产 seed。
 *
 * 本地：建 anxin_medication_test（若无）→ 跑 api 迁移（纯 SQL）→ seed 演示用户 p-001 +
 *       golden case 的 drug_master（玻璃酸钠 0.1%）+ 说明书 dosage 锚点（范围校验 pass 基准）；
 *       teardown drop 测试库（with force），保证每次 E2E 从干净状态开始。
 *       与单测（packages/api globalSetup）同库不同时机：E2E 单独起 api/web 进程，故自行管理库生命周期。
 *       需要 anxin 角色具备 CREATEDB 权限（与单测一致）。
 * 远端（E2E_DB_URL + E2E_ALLOW_REMOTE_DB=1）：库是部署自身的，**不建不删**——只做「补齐到可跑态」
 *       （迁移幂等 no-op + golden 行 on conflict do nothing）；测试数据会留在该库，跑完按
 *       app/deploy/README.md §9.1 用备份恢复。
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { ADMIN_URL, TEST_URL, TEST_DB_NAME, MIGRATIONS_DIR, isRemoteDbTarget } from './lib/test-db.js'

/** golden case 的库条目（与 fixtures/golden-cases.json drug.drugMaster 对齐）。 */
const DM_ID = 'dm-t9-hycosan'
const PI_ID = 'pi-e2e-hycosan'

/** 迁移 + golden 基线行（幂等），用完关连接。 */
async function prepareBaselines(client: postgres.Sql) {
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  // 演示用户（resolveUser 固定 p-001）
  await client.unsafe(
    `insert into users (id, name, email, phone) values ('p-001', '张某某', 'p001@anxin.test', '13800000000')
     on conflict (id) do nothing`,
  )
  // golden case 库条目：rx-normal/rx-redacted/drug-box 提取 0.1% → 唯一匹配；rx-spec-conflict 提取 0.2% → 规格冲突
  await client.unsafe(
    `insert into drug_master (id, generic_name, specification, form, curation_status)
     values ('${DM_ID}', '玻璃酸钠滴眼液', '0.1%（10mL:10mg）', '滴眼液', 'mock')
     on conflict (id) do nothing`,
  )
  // 说明书 dosage 锚点：上限 10 次/日 → rx-normal 频次 4 → 范围校验 pass
  await client.unsafe(
    `insert into package_inserts (id, drug_id, generic_name, dosage, source, version)
     values ('${PI_ID}', '${DM_ID}', '玻璃酸钠滴眼液',
       '{"adult":{"dosePerUse":{"value":1,"unit":"滴"},"maxFrequencyPerDay":{"value":10,"unit":"次"}}}'::jsonb,
       '海露说明书', 'v1')
     on conflict (id) do nothing`,
  )
  console.log('[e2e-setup] 迁移 + seed 完成（p-001 / dm-t9-hycosan / pi-e2e-hycosan）')
  await client.end()
}

export default async function setup() {
  if (isRemoteDbTarget) {
    console.log('[e2e-setup] 远端模式：目标库为部署自身的库，跳过建库/删库生命周期')
    await prepareBaselines(postgres(TEST_URL, { max: 1 }))
    return () => {}
  }

  // 1. 建测试库（幂等）
  const admin = postgres(ADMIN_URL, { max: 1 })
  try {
    const exists = await admin`select 1 from pg_database where datname = ${TEST_DB_NAME}`
    if (exists.length === 0) {
      await admin.unsafe(`create database ${TEST_DB_NAME}`)
      console.log(`[e2e-setup] 创建测试库 ${TEST_DB_NAME}`)
    }
  } finally {
    await admin.end()
  }

  // 2. 迁移 + seed
  await prepareBaselines(postgres(TEST_URL, { max: 1 }))

  // 3. teardown：drop 测试库
  return async () => {
    const admin2 = postgres(ADMIN_URL, { max: 1 })
    try {
      await admin2.unsafe(`drop database if exists ${TEST_DB_NAME} with (force)`)
      console.log('[e2e-teardown] 已清理测试库 anxin_medication_test')
    } finally {
      await admin2.end()
    }
  }
}
