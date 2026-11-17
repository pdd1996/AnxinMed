-- M9 基线核对（2026-11-17）
-- 用法：psql -h localhost -U anxin -d anxin_medication -f tools/m9-baseline.sql
SET client_encoding = 'UTF8';

-- 1. 资产域
select count(*) as insert_rows,
       count(*) filter (where curation_status = 'reviewed') as reviewed_rows,
       count(*) filter (where curation_status = 'reviewed' and source like '说明书 PDF%') as reviewed_pdf_rows,
       count(*) filter (where source like '%丁香园%') as dxy_rows
from package_inserts;

select id, level, status, source from interaction_rules order by id;

-- 2. p-001 药箱：8 行（4 manual 演示药 + 海露 4 行）
select id, generic_name, brand_name, drug_master_id, confirm_status, created_at
from drugs where user_id = 'p-001' order by created_at, id;

-- 3. 重复海露行引用检查（期望：仅 transcribed 行被 plan 引用；ocr_matched 3 行无引用）
select d.id, d.confirm_status,
       (select count(*) from plans p where p.drug_id = d.id) as plan_refs,
       (select count(*) from risk_events r where r.drug_id = d.id) as risk_event_refs,
       (select count(*) from drafts dr where dr.payload::text like '%' || d.id || '%') as draft_refs
from drugs d
where d.user_id = 'p-001' and d.drug_master_id = 'drug-hycosan-01'
order by d.created_at;

-- 4. 模拟相关：p-001 生效计划数 / 记录数
select (select count(*) from plans where user_id = 'p-001' and status = 'active') as active_plans,
       (select count(*) from records where user_id = 'p-001') as records;

-- 5. 候选挖掘语料：reviewed PDF 行中【药物相互作用】段可得数
select count(*) as reviewed_pdf_rows,
       count(*) filter (where source_sections ? '药物相互作用'
                          and length(coalesce(source_sections->>'药物相互作用','')) > 0) as with_interactions_section,
       count(*) filter (where content_hash is null) as hash_null
from package_inserts
where curation_status = 'reviewed' and source like '说明书 PDF%';
