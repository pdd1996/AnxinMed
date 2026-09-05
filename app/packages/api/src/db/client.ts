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
