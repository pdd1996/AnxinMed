# consult-labels · 意图漏判率抽检标注（docs/11 §2.1）

每月从 consult_logs 随机抽 30 条导出的标注 CSV（question 落库前已脱敏；入库前请再人工过目）。

- 导出：`cd app/packages/api && npm run eval:export-labels -- --month=YYYY-MM --count=30 > YYYY-MM.csv`
- 标注：填 `label(应路由意图)` 列，口径见 docs/11 §2.1
- 结果回填 docs/11 §2.1 抽检记录表
