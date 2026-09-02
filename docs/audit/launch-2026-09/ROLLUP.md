# Launch audit — findings rollup

_Generated 2026-09-02T03:21:39.357Z from findings.jsonl. Do not hand-edit — run `node scripts/audit-bus.mjs rollup`._

**6 live findings** · 2 launch blockers · 1 retracted · 1 fixed

## HIGH (3)

| ID | Blocker | Status | Surface | Claim | Agent | Evidence |
|---|---|---|---|---|---|---|
| SI-001 | **YES** | filed | `worker_protection_credits` | Worker protection credits appear to be created but never issued/applied: table referenced by 1 src file (CancellationDialog.tsx) and 0 edge functions, yet has a pending->issued->applied->expired status machine | lh-schema-integrity | 2 |
| SI-005 | **YES** | filed | `create_business_api_key + business_* objects` | B2B tier is removed as a product but its SECURITY DEFINER API-key-minting RPC and related tables may still exist in prod: live attack surface for a product that no longer exists | lh-schema-integrity | 1 |
| O-001 |  | fixed | `.claude/commands/audit.md` | The /audit command still instructed every audit that there is 'no meaningful native code' - the exact sentence CLAUDE.md identifies as the cause of push being dead for the life of the project. FIXED during fleet setup. | lh-orchestrator | 1 |

## MEDIUM (3)

| ID | Blocker | Status | Surface | Claim | Agent | Evidence |
|---|---|---|---|---|---|---|
| SI-002 |  | verified | `time_credits` | time_credits (time banking) has no product surface: referenced only by 2 test files in src/; balance_after is an app-maintained snapshot with no DB-level guarantee, so it can drift silently | lh-schema-integrity | 1 |
| SI-003 |  | filed | `businesses / business_* (deleted B2B tier)` | B2B tier is deleted but its objects may still exist in prod; migration history still contains business RPCs incl. create_business_api_key (SECURITY DEFINER). Needs live pg_proc/pg_tables verification, not a migration read | lh-schema-integrity | 1 |
| SI-004 |  | verified | `helper_circles / helper_circle_members` | Dead tables with zero references anywhere: 0 files in src/, 0 edge functions. Superseded by favorite_helpers + ?tab=saved_helpers | lh-schema-integrity | 1 |
