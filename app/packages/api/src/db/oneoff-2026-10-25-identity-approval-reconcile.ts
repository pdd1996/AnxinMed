/**
 * 一次性回填（2026-10-25）——用 PDF manifest 补现有 drug_master 的空批准文号并重算指纹。
 *
 * 仅处理 approval_number / approval_numbers 都为空的资产；匹配键为归一化后的
 * 通用名 + 规格 + 剂型 + 厂家。manifest 中同键多批号视为歧义，直接中止，不猜。
 *
 * 用法：
 *   tsx src/db/oneoff-2026-10-25-identity-approval-reconcile.ts          # dry-run
 *   tsx src/db/oneoff-2026-10-25-identity-approval-reconcile.ts --apply  # 落库
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { db, client } from './client.js'
import { makeIdentityKey, normKey, normalizeSpecification } from './identity.js'
import { drugMaster } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const manifestPath = join(repoRoot, 'data', 'manuals-manifest.jsonl')

interface ManifestRow {
  sourceFile: string
  genericName: string
  specification: string
  form: string
  manufacturer: string | null
  approvalNumbers: string[]
  identityKey: string
}

function weakKey(d: {
  genericName: string
  specification: string
  form: string
  manufacturer: string | null
}): string {
  return [
    normKey(d.genericName),
    normalizeSpecification(d.specification),
    normKey(d.form),
    normKey(d.manufacturer ?? ''),
  ].join('|')
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply')
  let manifest: ManifestRow[]
  try {
    manifest = readFileSync(manifestPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ManifestRow)
  } catch (err) {
    console.error(`❌ 读取 manifest 失败：${manifestPath}`, err)
    return 1
  }

  const candidates = new Map<string, ManifestRow[]>()
  for (const row of manifest) {
    if (!row.approvalNumbers?.length || !row.identityKey) continue
    const key = weakKey(row)
    candidates.set(key, [...(candidates.get(key) ?? []), row])
  }

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

  const changes: Array<{
    id: string
    specification: string
    oldKey: string | null
    newKey: string
    approvals: string[]
    primaryApproval: string
    sourceFile: string
  }> = []
  const unmatched: string[] = []
  const issues: string[] = []

  for (const m of rows) {
    if (m.approvalNumber || (m.approvalNumbers && m.approvalNumbers.length > 0)) continue
    const matches = candidates.get(weakKey(m)) ?? []
    if (matches.length === 0) {
      unmatched.push(m.id)
      continue
    }

    const unique = new Map<string, ManifestRow>()
    for (const match of matches) {
      const approvalKey = [...match.approvalNumbers].sort().join('|')
      unique.set(approvalKey, match)
    }
    if (unique.size > 1 || new Set([...unique.values()].map((x) => x.identityKey)).size > 1) {
      issues.push(`${m.id}: manifest 匹配到多组批号/身份，需人工裁决`)
      continue
    }

    const match = [...unique.values()][0]
    const approvals = match.approvalNumbers
    const newKey = makeIdentityKey({
      genericName: m.genericName,
      specification: m.specification,
      form: m.form,
      manufacturer: m.manufacturer,
      approvalNumbers: approvals,
    })
    if (newKey !== match.identityKey) {
      issues.push(`${m.id}: 补批号后指纹与 manifest 不一致，未回填`)
      continue
    }

    const primaryApproval = approvals.find((a) => !a.includes('分包装')) ?? approvals[0]
    changes.push({
      id: m.id,
      specification: m.specification,
      oldKey: m.identityKey,
      newKey,
      approvals,
      primaryApproval,
      sourceFile: match.sourceFile,
    })
  }

  const finalKeys = new Map<string, string[]>()
  for (const m of rows) {
    const changed = changes.find((c) => c.id === m.id)
    const key = changed?.newKey ?? m.identityKey
    if (!key) continue
    finalKeys.set(key, [...(finalKeys.get(key) ?? []), m.id])
  }
  for (const [key, ids] of finalKeys) {
    if (ids.length > 1) issues.push(`回填后指纹撞车 ${key.slice(0, 12)}: ${ids.join(', ')}`)
  }

  console.log(`批号回填：库内 ${rows.length} 行，空批号 ${rows.filter(
    (m) => !m.approvalNumber && (!m.approvalNumbers || m.approvalNumbers.length === 0),
  ).length} 行，可回填 ${changes.length} 行，无匹配 ${unmatched.length} 行`)
  for (const c of changes) {
    console.log(`  ${c.id} | ${c.specification}`)
    console.log(`    ← ${c.sourceFile}`)
    console.log(`    批号：${c.approvals.join('、')}`)
    console.log(`    ${c.oldKey?.slice(0, 12) ?? '(null)'} → ${c.newKey.slice(0, 12)}`)
  }
  if (unmatched.length) console.log(`  无匹配：${unmatched.join(', ')}`)
  if (issues.length) {
    console.error('\n❌ 存在问题，未落库：')
    for (const issue of issues) console.error(`   ${issue}`)
    return 1
  }

  if (!apply) {
    console.log('\nDRY-RUN：未落库。确认后加 --apply 执行。')
    return 0
  }

  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx.update(drugMaster).set({ identityKey: `tmp-recon-${c.id}` }).where(eq(drugMaster.id, c.id))
    }
    for (const c of changes) {
      await tx.update(drugMaster)
        .set({
          approvalNumber: c.primaryApproval,
          approvalNumbers: c.approvals,
          identityKey: c.newKey,
          updatedAt: new Date(),
        })
        .where(eq(drugMaster.id, c.id))
    }
  })

  console.log(`✅ 已回填 ${changes.length} 行批号并重算指纹`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 批号回填失败（事务已回滚）:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
