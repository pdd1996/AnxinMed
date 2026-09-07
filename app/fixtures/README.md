# app/fixtures · golden case 样张资产（M2-T9 / T10 共用，git 管理）

> 本目录是录入主线 golden case 的**测试资产真相源**。CI 与日常回归只消费文本真相（`golden-cases.json`），
> 不读像素；PNG 供 T10 `test:e2e:live` 真实 OCR（qwen3.5-ocr 云端转录，ADR #16）与人工 oracle 审核。

## 唯一真相源

`golden-cases.json` 同时驱动两条链路，**永不漂移**：

| 消费方 | 用途 |
|--------|------|
| `make-fixtures.py`（Pillow） | 据 `lines` 渲染 PNG；`redact` 行号画黑框（涂黑遮挡变体） |
| `packages/api/src/__tests__/zero-leak.test.ts` | 据同一份 `lines`（去掉 `redact` 行 = OCR 可见文本）生成 mock OCR，驱动**真管线**做零泄漏断言 |

T10 E2E 的 `FixtureAiClients` 回放与 live 上传同样以本目录为准（场景名 = `x-test-scenario`）。

## 资产清单

| 文件 | 场景 | 说明 |
|------|------|------|
| `rx-normal.png` | rx-normal | 合成处方笺 golden case：前记含姓名/电话/病历号/地址（L0 裁掉）+ 诊断内嵌复诊电话（L2 脱敏）。全字段完整，不触发兜底 |
| `rx-redacted.png` | rx-redacted | 涂黑变体：日期行 + 用法行涂黑 → needsManual → 触发 Baichuan 兜底（验第三方请求体零泄漏 + 回链拦截不预填） |
| `golden-cases.json` | — | 文本真相源：逐行处方 + redact 行号 + VLM identity + 兜底幻觉值 + 合成 PII 块 |
| `make-fixtures.py` | — | Pillow 渲染器（对齐 `tools/ocr-bench/make_sample.py` 做法） |

## 重新生成样张

```bash
pip install pillow            # 仅需 Pillow，无其它依赖
python app/fixtures/make-fixtures.py
```

渲染用微软雅黑（`C:/Windows/Fonts/msyh.ttc`）；字体缺失时打印 `[warn]` 回退默认字体（不静默）。

## 合成 PII 声明

`golden-cases.json` 的 `pii` 块（张三 / 13800001234 / MZ20260001 / 广东省深圳市南山区科技路1号 / 李四）
均为**合成假数据**（13800001234 为公认测试号段），仅用于验证脱敏零泄漏，**绝非真实用户信息**，可安全入库。
zero-leak 断言要求：这四类身份信息在 DB 落库 / 日志 / 第三方请求体三类产物中命中数 **= 0**。

## 扩展（T10）

新增场景只需在 `golden-cases.json.scenarios` 加一项（`image` / `layers` / `lines` / `redact` / `fallback`），
重跑 `make-fixtures.py` 即得 PNG；药盒（drug-box-labeled）与散装药片（unsupported-loose-pills）样张同法追加。
