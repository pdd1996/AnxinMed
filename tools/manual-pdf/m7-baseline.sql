-- M7 基线核对（2026-11-15）
-- 用法：psql -h localhost -U anxin -d anxin_medication -f tools/manual-pdf/m7-baseline.sql
-- 期望值见 docs/specs/07-M7-说明书库缺陷修复.md §1；数字不一致时先停下核对，不要继续重提取。
SET client_encoding = 'UTF8';

\echo '== 表规模 =='
select (select count(*) from package_inserts) as insert_rows,
       (select count(*) from drug_master) as master_rows,
       (select count(*) from package_inserts where curation_status = 'reviewed') as reviewed_rows,
       (select count(*) from package_inserts where curation_status = 'crawled') as crawled_rows,
       (select count(*) from manual_review_log) as review_log_rows;

\echo '== 来源分布（PDF 行 = 1588，丁香园 15） =='
select case when source like '说明书 PDF%' then 'pdf' else 'dxy' end as src, count(*)
from package_inserts group by 1 order by 1;

\echo '== 商品名缺失但源文有「商品名：」标签（§3.7，期望 25） =='
select count(*) from package_inserts
where (brand_name is null or brand_name = '')
  and coalesce(source_sections->>'药品名称', '') ~ '商品名[：:]';

\echo '== 多批准文号行（期望 344，含正常多包装） =='
select count(*) from package_inserts
where jsonb_array_length(coalesce(approval_numbers, '[]'::jsonb)) > 1;

\echo '== 一份 PDF 多行（期望 219） =='
select count(*) from (select source_file from package_inserts group by source_file having count(*) > 1) t;

\echo '== 表格拉平签名（§4.2，期望 354 / reviewed 62 / 涉 250 份 PDF） =='
with sig as (
  select id, curation_status, source_file,
    (adverse_reactions ~ '十分常见[\s\S]{0,80}常见[\s\S]{0,160}(偶见|罕见)'
     or (adverse_reactions like '%系统器官分类%' and adverse_reactions like '%常见%')) as freq
  from package_inserts
)
select count(*) filter (where freq) as all_rows,
       count(*) filter (where freq and curation_status = 'reviewed') as reviewed_rows,
       count(distinct source_file) filter (where freq) as pdfs
from sig;

\echo '== 已含 Markdown 表格的段落（期望 0） =='
select count(*) from package_inserts where source_sections::text like '%| %';

\echo '== 草稿 ↔ 库对账（另跑） =='
\echo '   cd app && pnpm --filter @anxin/api db:import-manuals -- --dry-run  → 新增 0 / 刷新 0 / 跳过 1588'
