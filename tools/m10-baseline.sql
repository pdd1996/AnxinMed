-- M10 基线核对（2026-11-17）
-- 用法：psql -h localhost -U anxin -d anxin_medication -f tools/m10-baseline.sql
SET client_encoding = 'UTF8';

-- 1. 规则库：3 条 demo / 0 curated；drug_groups 应全为空（迁移 0011 后）
select id, level, status, drug_ids, drug_groups, source
from interaction_rules order by id;

select status, count(*) from interaction_rules group by 1 order by 1;

-- 2. 概念组就绪检查
select count(*) as master_rows from drug_master;
select count(*) filter (where drug_groups is null) as rules_without_groups from interaction_rules;

-- 3. reviewed 语料（M9 候选池来源）
select count(*) as reviewed_pdf_rows
from package_inserts
where curation_status = 'reviewed' and source like '说明书 PDF%';

-- 4. p-001 药箱（M9 清理后应为 5 行）
select id, generic_name, drug_master_id, confirm_status
from drugs where user_id = 'p-001' order by created_at, id;
