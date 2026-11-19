import { Fragment } from 'react'
import { planMetaSegments, type PlanGroup } from '@anxin/core'

/**
 * 「规格 · 每次 · 每日 · 途径」用法摘要（缺省项跳过），逐段包 `whitespace-nowrap`：
 * 折行只可能发生在段与段之间，不会把「每日 1 次」拆成「每日 1 / 次」或「每 / 日 1 次」。
 *
 * 宽度与整句渲染一致（段间只有一个空格），所以 375px 下原本能单行的场合不会因分段变宽而折行；
 * 父级再给一个 `[text-wrap:balance]`，真正需要折行时（大字档/320px）会均衡成两行而不是剩一个「口服」。
 */
export function PlanMeta({ group }: { group: PlanGroup }) {
  const segments = planMetaSegments(group)
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={segment}>
          <span className="whitespace-nowrap">
            {index < segments.length - 1 ? `${segment} ·` : segment}
          </span>
          {index < segments.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </>
  )
}
