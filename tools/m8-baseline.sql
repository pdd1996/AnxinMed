-- M8 基线核对（2026-11-16）
-- 用法（有 psql 时）：
--   psql -h localhost -U anxin -d anxin_medication -f tools/m8-baseline.sql
-- 用法（无 psql 时）：用 node/postgres 逐条执行；期望值见 docs/specs/08-M8-上线前收口.md §1。
-- 数字不一致时先停在 T0 报告，不要继续后面的任务。
SET client_encoding = 'UTF8';

-- 1. 表规模与状态分布
select count(*) as insert_rows,
       count(*) filter (where curation_status = 'crawled') as crawled_rows,
       count(*) filter (where curation_status = 'reviewed') as reviewed_rows,
       count(*) filter (where curation_status = 'mock') as mock_rows,
       count(*) filter (where source like '说明书 PDF%') as pdf_rows,
       count(*) filter (where source like '%丁香园%') as dxy_rows
from package_inserts;

select count(*) as master_rows from drug_master;

select curation_status,
       count(*) as rows,
       count(*) filter (where source like '%丁香园%') as dxy,
       count(*) filter (where interactions is not null and length(interactions) > 0) as interactions_nonempty
from package_inserts
group by curation_status
order by 1;

-- 2. reviewed 执行者与日志
select reviewed_by, count(*) as reviewed_rows
from package_inserts
where curation_status = 'reviewed'
group by 1;

select action, reviewer, count(*) as n
from manual_review_log
group by 1, 2
order by 1, 3 desc;

-- 3. 规则库与逐字校验（对库内 source_sections；DXY 行为空段，另见 §1）
-- 注：status/source_type/quote 列由 M8-T1 迁移新增；T0 基线时尚不存在，故此处只取原列。
select id, level, source,
       left(note, 60) as note_head
from interaction_rules
order by id;

select r.id,
       count(*) filter (where p.source_sections is not null
                          and strpos(coalesce(p.source_sections::text, ''), r.note) > 0) as note_in_raw_sections,
       count(*) filter (where p.source_sections ? '药物相互作用'
                          and strpos(coalesce(p.source_sections->>'药物相互作用', ''), r.note) > 0) as note_in_interactions
from interaction_rules r
left join package_inserts p on p.drug_id in (select jsonb_array_elements_text(r.drug_ids::jsonb))
group by r.id
order by r.id;

-- 4. DXY 15 行：状态、来源、段落/指纹缺口
select drug_id, curation_status,
       (source_sections is null or source_sections = '{}'::jsonb) as sections_empty,
       content_hash is null as hash_null,
       source_file is null as file_null,
       source_url is not null as has_url,
       (interactions is not null and length(interactions) > 0) as interactions_nonempty
from package_inserts
where source like '%丁香园%'
order by drug_id;

-- 5. p-001 在服计划 / 药箱 / 说明书状态
select p.id as plan_id, p.status, d.id as drug_id, d.generic_name,
       d.drug_master_id, d.confirm_status, pi.curation_status as insert_status
from plans p
join drugs d on d.id = p.drug_id
left join package_inserts pi on pi.drug_id = d.drug_master_id
where p.user_id = 'p-001' and p.status = 'active'
order by p.id;

-- 6. 全库【药物相互作用】段可得率（PDF / DXY 分列）
select case when source like '%丁香园%' then 'dxy' else 'pdf' end as src,
       count(*) as rows,
       count(*) filter (where interactions is not null and length(interactions) > 0) as interactions_nonempty
from package_inserts
group by 1
order by 1;
