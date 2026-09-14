/**
 * @anxin/mcp 入口（ADR #19）——stdio 传输的 MCP Server。
 *
 * ⚠️ stdio 模式下 stdout 是 MCP 协议通道：本文件及下游一律禁止向 stdout 打日志
 *    （console.log 会直接破坏协议帧），全部走 stderr（console.error）。
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config.js'
import { createMcpServer, MCP_SERVER_NAME } from './server.js'

const config = loadConfig()
const server = createMcpServer(config)
await server.connect(new StdioServerTransport())
console.error(`[mcp] ${MCP_SERVER_NAME} ready (stdio) → API ${config.baseUrl}`)
