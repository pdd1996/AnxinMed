SET client_encoding = 'UTF8';
\echo '== 表规模 =='
select (select count(*) from package_inserts) as insert_rows,
       (select count(*) from drug_master) as master_rows,
       (select count(*) from package_inserts where curation_status = 'reviewed') as reviewed_rows,
       (select count(*) from manual_review_log) as review_log_rows,
       (select count(*) from manual_review_log where action = 'correct' and reviewer like 'm7-%') as m7_correct_logs;

\echo '== §3.7 商品名缺失但源文有「商品名：」（修复前 25，期望 0） =='
select count(*) from package_inserts
where (brand_name is null or brand_name = '')
  and coalesce(source_sections->>'药品名称', '') ~ '商品名[：:]';

\echo '== §3.5 表格拉平签名（修复前 354 / reviewed 62 / 250 份 PDF） =='
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

\echo '== 含 Markdown 表格的行 / 段落（修复前 0） =='
select count(*) filter (where source_sections::text like '%| %') as rows_with_table
from package_inserts;

\echo '== §3.6 多批准文号行（修复前 344；期望只剩正常同规格多包装/一行多规格） =='
select count(*) from package_inserts
where jsonb_array_length(coalesce(approval_numbers, '[]'::jsonb)) > 1;

\echo '== 批准文号脏值（带冒号 / 带标签前缀；修复前 22 / 34） =='
select count(*) filter (where approval_numbers::text like '%：%') as with_colon,
       count(*) filter (where approval_numbers::text like '%进口药品注册证号%') as with_label
from package_inserts;

\echo '== 规格变化（修复后与草稿对账） =='
select count(*) from package_inserts where specification is null or specification = '';

\echo '== 身份指纹重复（应为 0） =='
select count(*) from (select identity_key from drug_master group by identity_key having count(*) > 1) t;

\echo '== 孤儿产品行 / 一行多说明书重复来源（应为 0） =='
select (select count(*) from drug_master m where not exists (select 1 from package_inserts p where p.drug_id = m.id)) as orphan_masters,
       (select count(*) from (select drug_id, source_file from package_inserts group by 1, 2 having count(*) > 1) t) as dup_source_rows;
