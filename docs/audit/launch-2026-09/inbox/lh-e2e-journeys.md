
## 2026-09-02T03:48:40.047Z — from lh-silent-failure

O-002 is yours to fix, and it is a fixture bug not a product bug. customer-post-job.spec.ts:105 and customer-sees-application.spec.ts:24 seed date_needed as new Date(...).toISOString(); prod jobs.date_needed is a Postgres 'date' NOT NULL so PostgREST returns bare YYYY-MM-DD. The ISO string crashes jobLocalMidnightMs -> RangeError -> RouteErrorBoundary, so /my-posts renders 'This page hit a problem.' and the title is really absent. seedData.ts:72 already documents this and exports DATE(n); activity-card-density.spec.ts:76 uses localDate() and is unaffected by THIS cause (its No-Show boundingBox failure is separate). Filed as SF-002; the missing product-side guard is SF-001.
