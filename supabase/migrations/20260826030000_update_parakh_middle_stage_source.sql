-- PARAKH moved the old PDF path. Keep the approved framework record pointed at
-- the current official landing page, which provides the maintained PDF download.
update public.hpc_framework_versions
set source_reference = 'https://parakh.ncert.gov.in/how-to-fill-the-hpc-middle-stage'
where framework_code = 'PARAKH_HPC_MIDDLE_STAGE'
  and version_label = '2023 Middle Stage core';
