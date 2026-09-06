/**
 * 数据库客户端 —— 供 seed / 爬虫 / 后续 API 层复用
 */
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL 未设置，请检查 .env 文件')
}

const client = postgres(connectionString)
export const db = drizzle(client, { schema })
export { client }

/**
 * 执行器类型（M2-T6b）—— 仓储写函数可选接受 `exec`，默认 `db`；确认事务内传 `tx` 令四表写入原子。
 * Tx 由 db.transaction 回调参数推导（drizzle postgres-js 事务与 db 共享 insert/select/update/delete 接口）。
 */
export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Executor = Db | Tx
