-- Controlled reference catalogue for the approved Middle Stage framework.
-- Source: PARAKH / NCERT, How to fill the HPC (Middle Stage), Annexure 3
-- (first edition, December 2023).  This only contains descriptors printed in
-- that source; learning outcomes stay empty where the source does not define
-- a catalogue-level outcome.

with framework as (
  select id from public.hpc_framework_versions
  where framework_code = 'PARAKH_HPC_MIDDLE_STAGE' and version_label = '2023 Middle Stage core'
), entries(domain_code, goal_code, goal_label, competency_code, competency_label) as (
  values
    ('language_1','L1CG1','Develops the capacity for effective communication using Language skills for description, analysis, and response','L1C1.1','Identifies main points and summarises from a careful listening or reading of the text (news articles, reports, editorials).'),
    ('language_2','L2CG1','Develops independent reading comprehension and summarising skills by engaging with a variety of texts and shows interest in reading books','L2C1.1','Applies varied comprehension strategies (inference, prediction, etc.) to understand different texts.'),
    ('language_3','L3CG1','Develops effective communication skills for day-to-day interactions, enhancing their oral ability to express ideas by describing and narrating events and situations','L3C1.1','Makes conversations relevant to the context.'),
    ('mathematics','MCG1','Understands numbers and sets of numbers (whole numbers, fractions, integers, rational numbers, and real numbers), looks for patterns, and appreciates relationships between numbers','MC1.1','Develops a sense for and an ability to manipulate and name large whole numbers of up to 20 digits, and expresses them in scientific notation using exponents and powers.'),
    ('science','SCCG1','Explores the world of matter and its constituents, properties, and behaviour','SCC1.1','Classifies matter based on observable physical and chemical characteristics.'),
    ('social_science','SSCG1','Comprehends and interprets sources related to different aspects of human life and makes meaningful interpretations','SSC1.1','Collects and interprets multiple sources of information (primary and secondary) to understand the historical, cultural, geographical, and socio-political aspects of human life.'),
    ('art_education','VACG2','Applies their imagination and creativity to explore alternative ideas through the arts','VAC2.2','Connects visual imagery, symbols, and visual metaphors with personal experiences, emotions, and imaginations.'),
    ('physical_education','P1CG1','Demonstrates intermediate body movements and motor skills to participate in different physical activities, games, or sports and develop their understanding','P1C1.1','Develops power, speed, strength, balance, flexibility, judgment, and reflexes in motor movements.')
), goals as (
  insert into public.hpc_curricular_goals (domain_id, code, label)
  select domain.id, entries.goal_code, entries.goal_label
  from entries
  join framework on true
  join public.hpc_domains domain on domain.framework_version_id = framework.id and domain.code = entries.domain_code
  on conflict (domain_id, code) do update set label = excluded.label
  returning id, code
)
insert into public.hpc_competencies (curricular_goal_id, code, label)
select goals.id, entries.competency_code, entries.competency_label
from entries join goals on goals.code = entries.goal_code
on conflict (curricular_goal_id, code) do update set label = excluded.label;
