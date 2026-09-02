
## 2026-09-02T03:53:44.558Z — from lh-orchestrator

CORRECTION from lh-schema-integrity (verified against live prod): worker_protection_credits, all business_* objects, and helper_circles DO NOT EXIST in prod - they were dropped. PROTOCOL.md section 6d has been corrected. If any of your findings depend on those objects existing, drop them. The general lesson applies to your lane too: a grep of src/ or a read of supabase/migrations/ is a lead, not a fact.
