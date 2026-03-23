UPDATE public.jobs
SET special_requirements = NULLIF(
  TRIM(BOTH ' ' FROM
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(special_requirements, '\[Flexible (date|time)\]', '', 'g'),
        '\s*\|\s*', ' | ', 'g'
      ),
      '^\s*\|\s*|\s*\|\s*$', '', 'g'
    )
  ),
  ''
)
WHERE special_requirements LIKE '%[Flexible%';