# 说明书 PDF 交叉复核（MinerU 表格结构第二意见）

> 状态：**工具已落地、只读试点完成（2026-11-19）**。结论：MinerU 不替换 `tools/manual-pdf/extract.py`，
> 只作为「表格结构第二意见 + 独立文本复核」；本工具不写数据库、不改草稿，产出交人工签核。
> 关联：M6/M7 说明书库（[06](./specs/06-M6-说明书库落地与关账.md) · [07](./specs/07-M7-说明书库缺陷修复.md)）、
> 工具 [`tools/manual-pdf/mineru_xcheck.py`](../tools/manual-pdf/mineru_xcheck.py)。

## 1. 结论与定位

| 问题 | 结论 |
|---|---|
| 能否用 MinerU 替代 `extract.py` 重跑 1257 份 PDF？ | **不能**。MinerU 输出是整份 Markdown/MiddleJSON，不是【段名】+多规格+批准文号归属契约；替换会触发 `contentHash`、`drugId` 沿用、reviewed write-once、`manual_review_log` 审计链（M7 量级返工），而收益只有表格结构。 |
| 那就不能用了吗？ | **能，作为第二意见**。M7 的残留问题（R1 类：表格右列被页面裁切导致 `find_tables` 少列、合并单元格被拉平成空单元格）正是 MinerU 的强项；它还能用文本层模式做独立复核，成本低。 |
| 用哪个档位？ | **basic**（ONNX 小模型 + 文本层）。文本层 PDF 上 `parse_mode=txt`，不 OCR、不改写文字；standard/advanced 的 VLM 有改写原文风险（见 §6），说明书逐字场景禁用。 |
| 产出怎么用？ | `candidates.jsonl` 逐条人工签核；结构升级候选附带「MinerU 重排后的 Markdown 表」，裁切候选附带「回补后缀」。签核后才走 M7 已有的 reviewed 修正通道。 |

## 2. 试点实测（2026-11-19，MinerU 4.2.3 / basic / CPU）

**样本**：M7 质量扫描的 30 行残差（`data/m7-reports/quality-scan.json` 的 `samples`）→ 21 份 PDF / 211 页。

| 指标 | 结果 |
|---|---|
| 解析失败 | 0 / 21 份 |
| 单机耗时 | 21 份 211 页 ≈ 20 分钟（WSL2/i5-13500H，CPU，每文件含 ~6s 模型加载；0.17–0.45 页/秒） |
| 段名对齐 | 30/30 行【段名】与草稿 100% 对齐（含段标题与正文挤在同一文本块的情形） |
| 文本保真 | 整行字符覆盖 min 0.982 / p25 0.994 / median 0.998；仅 4 行 <0.99（同一份 PDF 的临床试验表数字丢失） |
| 结构判定 | structure-upgraded **12** / merged-cells-resolved **11** / structure-same **7** |
| 候选处置 | upgrade-table-structure **33** / manual-review **5**（共 38 条） |
| 表数量 | PyMuPDF 120 张 vs MinerU 114 张（MinerU 会合并相邻小表，列数增益见下） |
| 列数增益样本 | 丁二磺酸 2→3 列（R1 病例）、甲磺酸雷沙吉兰 4→5、卡前列素 4→5、米氮平 3→4、注射用泮托拉唑钠 2→3 |

**R2 单行验证**（丙戊酸钠口服溶液，18 页）：两边都识别为 **0 张表**，文本覆盖 **0.99958**，判定
`no-source-table` → `confirm-no-source-table`。即 R2「无框线表格」在源文里其实是「系统器官 + 频次」
叙述清单，**不是表格**，无需结构重建（与 M7 残留分类一致）。

**已知真丢字样本**（走 manual-review，不改库）：司美格鲁肽【药物相互作用】7 种字、替格瑞洛【不良反应】
4 种字、盐酸吡格列酮【药物相互作用】3 种字、司美格鲁肽【成份】3 种字——MinerU 的公式/上下标识别
会吞掉少量字符，必须人工复核。

## 3. 工具用法

```bash
# 0) 前置（本机已装好）：WSL2 Ubuntu + ~/mvenv（Python 3.12）+ MinerU 4.2.3
#    模型：MINERU_HOME=/mnt/d/tmp/mineru-pilot/home-wsl，basic 小模型包 839MB（ModelScope）
# 1) 选目标：默认 M7 质量扫描的 30 行残差；也可指定 drugId 或整段复跑
python tools/manual-pdf/mineru_xcheck.py plan \
  --scan data/m7-reports/quality-scan.json --out data/mineru-xcheck
#    → data/mineru-xcheck/plan.jsonl + run-mineru.sh（LF 换行，含 MINERU_HOME/档位/模型源）

# 2) 在 WSL/Linux 执行批跑（模型只加载一次/文件；Windows 原生跑不了，见 §6）
bash data/mineru-xcheck/run-mineru.sh

# 3) 生成三方对照报告（PyMuPDF / MinerU / 草稿）
python tools/manual-pdf/mineru_xcheck.py report \
  --plan data/mineru-xcheck/plan.jsonl --mineru-out data/mineru-xcheck/raw \
  --out data/mineru-xcheck
#    → report.md（人读）/ report.json（机读）/ candidates.jsonl（逐条签核）
```

按 drugId 扩展（例如对 reviewed 245 行做独立复核）：

```bash
python tools/manual-pdf/mineru_xcheck.py plan --no-scan \
  --drug-ids drug-x drug-y --out data/mineru-xcheck/reviewed
```

单测（不需要 PyMuPDF / MinerU 产物）：`python -m unittest discover -s tools/manual-pdf -p 'test_*.py'`。

## 4. 判定与处置口径

| verdict | 含义 | action |
|---|---|---|
| `structure-upgraded` | MinerU 识别出比草稿更多的列（如 R1 裁切列恢复 3 列、合并表被拆开） | `upgrade-table-structure`（附重排后的 Markdown 表） |
| `merged-cells-resolved` | MinerU 用 `rowspan/colspan` 表达了合并单元格，而草稿是空单元格拉平 | `upgrade-table-structure` |
| `mineru-missed-table` | 草稿有表、MinerU 没有 → MinerU 不可用 | `manual-review` |
| `mineru-extra-table` | MinerU 有表、草稿没有 → 需人工看是否源文有表 | `review-extra-table` |
| `no-source-table` | 两边都没表且不像频率表 → 不进候选；像「拉平的频率表」→ 确认源文无表 | `confirm-no-source-table` |
| `structure-same` | 结构一致 | 无（除非带 `serious-text-gap`） |

flags：`text-gap`（覆盖 <99%）、`serious-text-gap`（完全没出现的文字/数字 ≥3 种）、
`source-clipped`（贴页边的表格，附裁切回补候选）、`merged-cells-flattened`。

**红线**：工具只读，不写库；`candidates.jsonl` 只是签核清单，任何修改都必须走人工判定 +
M7 的 reviewed 修正通道（`db:review-export` → `decisions.json` → `db:review-apply`）。

## 5. 与现有提取器的互补关系

- `extract.py`：契约层权威（【段名】、多规格拆分、批准文号归属、身份/哈希、逐字校验），
  文本层抽取与保字优先（页外文字也能取到）。
- MinerU：结构层第二意见（行列/合并单元格/跨页合并），但按 bbox 识别，**贴页边的表格单元格会
  被页面边界裁掉**（实测丁二磺酸丢 2 字：`呕吐、食管`→`呕吐、食`、`支气管痉挛`→`支气管`），
  公式识别还会 LaTeX 化（`C19H32N2O5·C4H11N`）或在极端情况下吞字。
- 正确用法：**MinerU 给网格 + `extract.py` 文本层补字**，人工核对后落草稿。

## 6. 已知限制与部署约束

1. **Windows 原生不可用**：本机系统 `msvcp140.dll` 停留在 VS2015（14.00），`onnxruntime` DLL 初始化
   失败（换 DirectML/CPU 版、换 1.24/1.32 均失败）。WSL2 Ubuntu 26.04 正常。若要在 Windows 直跑，
   需安装 VC++ 2015-2022 x64 redist。
2. **VLM 档有改写风险**：standard/advanced 会为通顺而重复/改写原文；社区已确认（MinerU issue
   #3312/#5155）。说明书逐字入库场景只用 basic。
3. **表格贴边裁切**：源 PDF 表格右列超出页面时，MinerU 单元格文本被裁；工具会给出回补候选，但
   必须人工确认。
4. **公式/上下标**：化学式、`×10^6`、`Cmax` 等会变成 LaTeX 或被吞（`lostDistinctContent` 指标会标出）。
5. **成本**：CPU 0.17–0.45 页/秒（本机）；全库 10553 页约 6–10 小时/单进程，适合夜间/批量复核，
   不适合作为在线解析。
6. **许可证**：Apache-2.0 + 附加条款（MAU > 1 亿或月收入 > $2000 万需商业许可；对外提供在线服务
   需标注“使用了 MinerU”）。本地只读数据流水线无额外义务；注意 ≤3.0 旧版是 AGPL，勿混装。

## 7. 后续建议

- **P0（已完成）**：30 行残差交叉复核，产出 `candidates.jsonl` 交人工签核。
- **P1（可选）**：对 reviewed 245 行做独立文本复核（`--no-scan --drug-ids ...`），成本约 40 分钟，
  用于发现源文缺陷（R3）与串行问题。
- **P2（暂不做）**：全量 1257 份替换提取器；如未来引入指南/共识 PDF 知识库或扫描版说明书，
  再评估 standard 档 + GPU 服务器。
