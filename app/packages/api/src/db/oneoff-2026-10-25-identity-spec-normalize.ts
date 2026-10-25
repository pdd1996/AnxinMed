/**
 * 一次性回填（2026-10-25）——规格单位归一化后重算 drug_master.identity_key。
 *
 * 背景：identity.ts 现在会把「0.65克 / 0.65 g」「5微克 / 5μg / 5mcg」等规格写法归一，
 * 否则 PDF 导入会给已有 DXY 资产重复建档。本脚本只更新 identity_key，幂等。
 *
 * 用法：
 *   tsx src/db/oneoff-2026-10-25-identity-spec-normalize.ts          # dry-run
 *   tsx src/db/oneoff-2026-10-25-identity-spec-normalize.ts --apply  # 落库
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db, client } from './client.js'
import { makeIdentityKey } from './identity.js'
import { drugMaster } from './schema.js'

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply')
  const rows = await db.select({
    id: drugMaster.id,
    genericName: drugMaster.genericName,
    specification: drugMaster.specification,
    form: drugMaster.form,
    manufacturer: drugMaster.manufacturer,
    approvalNumber: drugMaster.approvalNumber,
    approvalNumbers: drugMaster.approvalNumbers,
    identityKey: drugMaster.identityKey,
  }).from(drugMaster)

  const next = rows.map((m) => {
    const approvals = m.approvalNumbers ?? (m.approvalNumber ? [m.approvalNumber] : [])
    return {
      ...m,
      nextKey: makeIdentityKey({
        genericName: m.genericName,
        specification: m.specification,
        form: m.form,
        manufacturer: m.manufacturer,
        approvalNumbers: approvals,
      }),
    }
  })

  const byKey = new Map<string, string[]>()
  for (const m of next) {
    byKey.set(m.nextKey, [...(byKey.get(m.nextKey) ?? []), m.id])
  }
  const conflicts = [...byKey.entries()].filter(([, ids]) => ids.length > 1)
  if (conflicts.length > 0) {
    console.error('❌ 归一化后身份指纹撞车，未落库：')
    for (const [key, ids] of conflicts) console.error(`   ${key}: ${ids.join(', ')}`)
    return 1
  }

  const changes = next.filter((m) => m.nextKey !== m.identityKey)
  console.log(`身份指纹重算：${rows.length} 行，需更新 ${changes.length} 行`)
  for (const m of changes) {
    console.log(`  ${m.id}`)
    console.log(`    spec: ${m.specification}`)
    console.log(`    ${m.identityKey?.slice(0, 12) ?? '(null)'} → ${m.nextKey.slice(0, 12)}`)
  }

  if (!apply) {
    console.log('\nDRY-RUN：未落库。确认后加 --apply 执行。')
    return 0
  }

  await db.transaction(async (tx) => {
    // 先腾空旧值，避免新旧指纹互换时触发唯一索引
    for (const m of changes) {
      await tx.update(drugMaster).set({ identityKey: `tmp-${m.id}` }).where(eq(drugMaster.id, m.id))
    }
    for (const m of changes) {
      await tx.update(drugMaster)
        .set({ identityKey: m.nextKey, updatedAt: new Date() })
        .where(eq(drugMaster.id, m.id))
    }
  })

  console.log(`✅ 已更新 ${changes.length} 行 identity_key`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 身份指纹回填失败（事务已回滚）:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
