/**
 * Seed 脚本 —— 从 demo/server/mock-data.json 导入数据资产三库
 *
 * 运行：npm run db:seed
 * 前提：docker compose up -d && npm run db:migrate
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './client.js'
import { drugMaster, packageInserts, interactionRules } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// __dirname = app/packages/api/src/db → 上溯 5 级到工作区根目录 AnxinMedication
const mockDataPath = join(__dirname, '..', '..', '..', '..', '..', 'demo', 'server', 'mock-data.json')

async function seed() {
  console.log('⚠️  本脚本导入 demo/server/mock-data.json 演示基线（含虚构说明书内容），仅用于建库基线与演示。')
  console.log('    需要纯净真实数据时：seed 后运行 pnpm run db:audit --purge-mock --confirm 清理演示行。\n')
  console.log('📖 读取 mock-data.json …')
  const raw = readFileSync(mockDataPath, 'utf8')
  const data = JSON.parse(raw)

  // ── 1. drug_master ──────────────────────────────────────────────
  console.log(`💊 导入药品身份库（${data.drugs.length} 条）…`)
  for (const drug of data.drugs) {
    await db
      .insert(drugMaster)
      .values({
        id: drug.id,
        genericName: drug.genericName,
        brandName: drug.brandName ?? null,
        specification: drug.specification,
        form: drug.form,
        manufacturer: drug.manufacturer ?? null,
        approvalNumber: drug.approval ?? null,
        otcClass: drug.otcClass ?? null,
        insuranceClass: drug.insuranceClass ?? null,
        isOriginal: drug.isOriginal ?? false,
        curationStatus: drug.curationStatus ?? 'mock',
        dataSource: drug.dataSource ?? 'demo/server/mock-data.json',
        note: drug.note ?? null,
      })
      .onConflictDoUpdate({
        target: drugMaster.id,
        set: {
          genericName: drug.genericName,
          brandName: drug.brandName ?? null,
          specification: drug.specification,
          form: drug.form,
          manufacturer: drug.manufacturer ?? null,
          approvalNumber: drug.approval ?? null,
          otcClass: drug.otcClass ?? null,
          insuranceClass: drug.insuranceClass ?? null,
          isOriginal: drug.isOriginal ?? false,
          curationStatus: drug.curationStatus ?? 'mock',
          dataSource: drug.dataSource ?? 'demo/server/mock-data.json',
          note: drug.note ?? null,
          updatedAt: new Date(),
        },
      })
  }

  // ── 2. package_inserts ──────────────────────────────────────────
  console.log(`📋 导入说明书库（${data.packageInserts.length} 条）…`)
  for (const insert of data.packageInserts) {
    const id = `pi-${insert.drugId}`
    await db
      .insert(packageInserts)
      .values({
        id,
        drugId: insert.drugId,
        genericName: insert.genericName,
        brandName: insert.brandName ?? null,
        form: insert.form ?? null,
        specification: insert.specification ?? null,
        indication: insert.indication ?? null,
        components: insert.components ?? null,
        dosage: insert.dosage ?? null,
        contraindications: insert.contraindications ?? null,
        adverseReactions: insert.adverseReactions ?? null,
        precautions: insert.precautions ?? null,
        interactions: insert.interactions ?? null,
        pharmacology: insert.pharmacology ?? null,
        pharmacokinetics: insert.pharmacokinetics ?? null,
        storage: insert.storage ?? null,
        afterOpeningDays: insert.afterOpeningDays ?? null,
        source: insert.source ?? null,
        version: insert.version ?? null,
        sourceUrl: insert.sourceUrl ?? null,
        curationStatus: insert.curationStatus ?? 'mock',
        curationNote: insert.curationNote ?? null,
      })
      .onConflictDoUpdate({
        target: packageInserts.id,
        set: {
          drugId: insert.drugId,
          genericName: insert.genericName,
          brandName: insert.brandName ?? null,
          form: insert.form ?? null,
          specification: insert.specification ?? null,
          indication: insert.indication ?? null,
          components: insert.components ?? null,
          dosage: insert.dosage ?? null,
          contraindications: insert.contraindications ?? null,
          adverseReactions: insert.adverseReactions ?? null,
          precautions: insert.precautions ?? null,
          interactions: insert.interactions ?? null,
          pharmacology: insert.pharmacology ?? null,
          pharmacokinetics: insert.pharmacokinetics ?? null,
          storage: insert.storage ?? null,
          afterOpeningDays: insert.afterOpeningDays ?? null,
          source: insert.source ?? null,
          version: insert.version ?? null,
          sourceUrl: insert.sourceUrl ?? null,
          curationStatus: insert.curationStatus ?? 'mock',
          curationNote: insert.curationNote ?? null,
          updatedAt: new Date(),
        },
      })
  }

  // ── 3. interaction_rules ────────────────────────────────────────
  console.log(`⚠️  导入相互作用规则库（${data.interactionRules.length} 条）…`)
  for (let i = 0; i < data.interactionRules.length; i++) {
    const rule = data.interactionRules[i]
    const id = `ir-${String(i + 1).padStart(3, '0')}`
    await db
      .insert(interactionRules)
      .values({
        id,
        drugIds: rule.drugs,
        level: rule.level,
        note: rule.note,
        source: rule.source,
      })
      .onConflictDoUpdate({
        target: interactionRules.id,
        set: {
          drugIds: rule.drugs,
          level: rule.level,
          note: rule.note,
          source: rule.source,
          updatedAt: new Date(),
        },
      })
  }

  // ── 汇总 ────────────────────────────────────────────────────────
  const masterCount = await db.select({ count: drugMaster.id }).from(drugMaster)
  const insertCount = await db.select({ count: packageInserts.id }).from(packageInserts)
  const ruleCount = await db.select({ count: interactionRules.id }).from(interactionRules)

  console.log('\n✅ Seed 完成！')
  console.log(`   药品身份库 drug_master:       ${masterCount.length} 条`)
  console.log(`   说明书库   package_inserts:   ${insertCount.length} 条`)
  console.log(`   相互作用库 interaction_rules: ${ruleCount.length} 条`)
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed 失败:', err)
    process.exit(1)
  })
