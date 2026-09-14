# @anxin/mcp — 安心用药 MCP Server（stdio）

把医生端只读数据端点打包成 [MCP](https://modelcontextprotocol.io)（Model Context Protocol）工具，供外部 Agent 客户端（Claude Desktop、Cursor、MCP Inspector 等）安全接入。决策记录见 `docs/07-技术选型决策记录.md` **ADR #19**。

## 安全模型（先读这段）

- **不碰数据库**：本服务只是转发层，把下方 3 个既有守门端点包成 MCP 工具。参数校验（zod）、意图路由、禁 text-to-SQL 边界全部留在 API 层（ADR #17），本层无任何 SQL 面——工具清单由测试钉死（`mcp-server.test.ts`「工具面红线」），**没有也不允许有 `execute_sql` / 任意查询类工具**；
- **只读**：全部工具 `readOnlyHint: true`，只调 GET / 只读 POST；
- **错误不外泄**：API 层用户文案（code + message）透传给模型；网络异常、堆栈等细节只进 stderr 日志；
- **权限不新增**：MVP 沿用 API 层演示用户上下文；`ANXIN_API_TOKEN` 为 API 层将来接入鉴权预留透传位；
- **stdout 是协议通道**：stdio 模式下所有日志走 stderr，禁止任何代码向 stdout 打印。

## 工具面（3 个，固定）

| 工具 | 参数 | 上游端点 |
|---|---|---|
| `doctor_ask` | `question`（1–200 字）、`patientId?`（缺省 = 队列维度） | `POST /api/insight/ask` |
| `queue_overview` | 无 | `GET /api/insight/queue` |
| `patient_adherence_series` | `patientId`、`days?`（1–90，默认 30） | `GET /api/insight/patients/:id/adherence-series` |

## 运行

```bash
# 前置：API 服务已在 8787 端口运行（cd app/packages/api && pnpm dev）
pnpm --filter @anxin/mcp build
node dist/index.js            # stdio 传输，等 MCP 客户端接入
```

环境变量（均有默认值，可省略）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `ANXIN_API_BASE_URL` | `http://127.0.0.1:8787` | 上游 API 地址 |
| `ANXIN_API_TOKEN` | — | 可选，设置后带 `Authorization: Bearer` 请求头 |
| `ANXIN_API_TIMEOUT_MS` | `10000` | 上游请求超时 |

## 接入 MCP Inspector（本地边界测试）

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Inspector 里除正常查询外，建议按 ADR #19 清单试负向用例：`days=200`（应被拒）、超长 `question`（应被拒）、不存在的 `patientId`（应返回 `NOT_FOUND` 用户文案）。

## 接入 Claude Desktop / Cursor（claude_desktop_config.json）

```json
{
  "mcpServers": {
    "anxin-med": {
      "command": "node",
      "args": ["C:\\Users\\Pan\\Desktop\\AnxinMed\\app\\packages\\mcp\\dist\\index.js"],
      "env": { "ANXIN_API_BASE_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

## 远程部署（暂不启用）

当前仅 stdio（本地进程、零网络攻击面）。将来若需远程服务（streamable-http），必须先补：强制 TLS、OAuth 2.1 / Bearer 鉴权、Host/Origin 白名单、限流——见 ADR #19「保留项」。
