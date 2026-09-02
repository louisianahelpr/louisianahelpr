# lh-trust-safety — lane report

**Worktree:** `~/.lh-audit/lh-trust-safety` @ `b170609a` (detached off `origin/main`)
**Live target:** prod `fncmgoasalhdgfwzhsqa`, read-only (`execute_sql`, SELECT / `pg_get_functiondef` / `pg_policies` / `pg_trigger` only). No `apply_migration`. No Stripe. No mutations.
**Findings filed:** TS-001 … TS-013.

---

## Headline

The **rule layer is strong and the enforcement layer is thin.** Reviews in particular are the best-defended surface I audited — the INSERT policy alone enforces party, direction, completion, escrow release, dispute state and a 30-day window, backed by a real unique constraint (artifacts: prod `pg_policies` `WITH CHECK` on `reviews`, and `reviews_job_id_reviewer_id_key UNIQUE (job_id, reviewer_id)` from `pg_constraint`). But three of the platform's advertised safety guarantees do not hold in prod, and each fails silently:

1. **The only automatic punishment for disintermediation does nothing** (TS-001). `scan_message_content` sets `auto_suspended_until`; the ban gate reads `ban_status`. The user is told they are suspended for 7 days and keeps full write access.
2. **A poster's "private note" about a Helpr is readable by that Helpr** (TS-002), reproduced live under real RLS. The source comment asserts the opposite.
3. **Blocking stops messages and nothing else** (TS-003, TS-011). The dialog promises "they won't be able to apply to your jobs"; there is no trigger or policy on `applications` that enforces it.

Plus the shape this repo keeps hitting — **a guard that reads as satisfiable and never runs**: the message-violation ladder cannot be reached from the app at all (TS-004), and prod row counts confirm it has never fired on a real user.

---

## Verified working (with artifacts)

| Control | Evidence |
|---|---|
| **Review authorization** — party, direction, `status='completed'`, `payment_status IN (released, payout_pending)`, no unresolved dispute, 30-day window, all server-side | prod `pg_policies` INSERT `WITH CHECK` on `reviews` |
| **No double review** | `reviews_job_id_reviewer_id_key UNIQUE (job_id, reviewer_id)` |
| **No self-review** | `enforce_review_validity` BEFORE INSERT, raises on `reviewer_id = reviewee_id` |
| **Blind reveal gating on read** | SELECT policy `reviewer_id = auth.uid() OR (status='published' AND feedback_visible_at <= now())` |
| **Public review disclosure is well-designed** | `get_public_profile_reviews` masks reviewer identity behind the same approved-and-not-banned rule, returns `job.category` not the free-text title, excludes cancelled jobs, paginates with a windowed count |
| **Saved-helper list excludes banned / unapproved** | `get_my_saved_helpers` body: `p.approval_status='approved' AND COALESCE(p.ban_status,'active')='active'` |
| **Block settles shared live jobs rather than stranding them** | `block_user_and_settle` takes the blocker from `auth.uid()`, locks `FOR UPDATE`, cancels through the real fee ladder, notifies in-transaction |
| **Block IS enforced on messages** | `trg_enforce_block_on_message_insert` BEFORE INSERT, raises `42501` |
| **Contraband cannot reach the recipient** | `messages_scan_content` BEFORE INSERT *and* BEFORE UPDATE OF content; `flagged_hidden` excluded by the receiver's SELECT policy and by `notify_message_recipient` |
| **Attachments are private + signed** | prod bucket row `message-attachments`: `public=false`, `file_size_limit=5242880`, `allowed_mime_types` set; client uses `createSignedUrl` only |
| **Reporting cannot be weaponized into an auto-ban** | `auto_escalate_reports` only inserts an admin `system_alert` at ≥3 open reports; it applies no restriction (I checked specifically because the migration is named `auto_escalate_and_restrict`) |
| **Report write is not a silent no-op** | `ReportDialog.tsx:218-249` uses `.select("id").single()` and checks both `error` and `!data` |

---

## Defects — see the bus for full repro

| ID | Sev | One line |
|---|---|---|
| TS-001 | **HIGH · blocker** | 7-day auto-suspension is cosmetic — sets `auto_suspended_until`, gate reads `ban_status` |
| TS-002 | HIGH | Poster's `private_note` readable by the Helpr it is about (reproduced live under RLS) |
| TS-003 | HIGH | Block does not stop applications, despite the dialog promising it |
| TS-004 | HIGH | Message-violation ladder unreachable from the app; never fired in prod |
| TS-005 | HIGH | Direct offer respects no blocks either way; `offered_to_helper_id` has no FK/CHECK/policy |
| TS-006 | HIGH | No report and no block control on a bid/application at all |
| TS-007 | HIGH | The Helpr has no SOS on an active job; no 911 path anywhere; SOS records nothing |
| TS-008 | MEDIUM | Blind period client-overridable via `feedback_visible_at` |
| TS-009 | MEDIUM | Ban gate absent from `reviews` — a banned user can still retaliate |
| TS-010 | MEDIUM | Scanner covers chat only; job posts, bios, applications, reviews, disputes unscanned |
| TS-011 | MEDIUM | Block enforced server-side in exactly one place app-wide |
| TS-012 | MEDIUM | Reports unthrottled; only `type='user'` at ≥3 notifies anyone |
| TS-013 | LOW | Apply limit shipped as 15/24h with no burst cap, not the decided 10/min·50/hr·200/day |

### Product findings stated plainly, as the brief asked

- **Disintermediation risk is real and one-channel.** Chat is defended; every other free-text field in the app is an open broadcast channel for the same content, and a job description reaches *every browsing helper*. Sizing: each off-platform booking is a lost platform fee **and** a job with no escrow, no dispute path, no location sharing and no record that it happened.
- **Blind review period exists** (14 days, reciprocal-reveal) — this is better than most marketplaces at launch. The gap is only that the hold is client-overridable.
- **Self-edit/delete of a review does not exist**, by omission rather than design: `reviews` has RLS enabled with SELECT and INSERT policies and **no UPDATE or DELETE policy**, so both are denied. `respond_to_review` (public reply) and `admin_delete_review` (operator takedown) cover the moderation need, so I am **not** filing this as a defect — but it should be a deliberate, stated choice rather than an accident of policy coverage.
- **Collusive rating inflation is not currently preventable.** Two accounts can post → complete → release → mutually 5-star, repeatedly. `flag_suspicious_review` exists as a detector; nothing rate-limits the loop. Not filed separately — it is the honest consequence of TS-008 plus no per-pair review cap, and the fix is a product decision.

---

## UNVERIFIED — could not reach, and why

- **No browser or simulator driving.** This lane was worked from source plus live SQL. Tap counts in TS-006 are derived from the actual component tree (mount sites, dropdown structure, gating conditions), **not** from operating the app. They are sound as reachability claims; treat the exact integers as ±1 until someone screenshots them.
- **TS-001 is proven by predicate evaluation, not by a live suspension.** I evaluated the exact `is_caller_banned()` predicate against the exact state `scan_message_content` writes, in prod. I did not suspend a real account to watch it fail, because the path has never fired in prod (`flagged_hidden = 0` across 83 messages) and firing it would require mutating a profile.
- **Message-attachment read policy** authorises off a self-asserted `attachment_url` with no validation that the message's `job_id` matches the object's path segment. Surfaced by a sub-agent; I did **not** independently reproduce it. **Routed to `lh-authz-rls` via the orchestrator — not filed by me**, because an unreproduced lead is a lead.
- **`application-attachments` bucket has `file_size_limit = null` and `allowed_mime_types = null`** in prod — no server-side size or type limit. Outside my lane; routed to `lh-edge-functions`/`lh-authz-rls`.
- **iOS/WKWebView surface** for report/block/SOS affordances: not driven.

## Out-of-scope conclusions (PROTOCOL §6)

- **No role-gating findings filed.** Every account both posts and does jobs; I treated all authorization as per-record.
- **Helper circles** — treated as dead per PROTOCOL §6d, not audited as product. `favorite_helpers` + `?tab=saved_helpers` is the live equivalent and is where my saved-helper work went (artifact: `favorite_helpers` carries 11 rows and two live RLS policies in prod).
- **`_shared/rate-limit.ts`** — not filed, per the brief. I did not audit the edge-function fallback logic; what I can attest is only that the durable half exists in prod (artifact: `rate_limit_hit(p_bucket, p_subject, p_ip, p_window_seconds, p_max, p_ip_max, p_forwarded_for)` and `prune_edge_rate_limit_log()` both present in `pg_proc`, both `SECURITY DEFINER`). Whether the in-memory Map is genuinely only a degraded fallback is `lh-edge-functions`' call, not mine.

## Coverage manifest

**Live DB objects read:** `can_review_job`, `enforce_review_validity`, `set_review_visibility`, `get_my_saved_helpers`, `get_public_profile_reviews`, `is_caller_banned`, `enforce_ban_gate`, `enforce_application_limit`, `block_shadowbanned_applications`, `are_users_blocked`, `is_helper_shadowbanned`, `auto_escalate_reports`, `scan_message_content`, `apply_message_violation_consequence`, plus a block/ban/approval-check matrix over 10 direct-offer and saved-helper functions. All triggers and policies on `reviews`, `applications`, `reports`, `favorite_helpers`, `messages`, and the `enforce_ban_gate` attachment set app-wide. Constraints, indexes and column privileges on `reviews` and `favorite_helpers`.

**Source read:** `SavedHelpersTab.tsx`, `savedHelpersTab/{useSavedHelpers,SavedHelperCard,types}.ts(x)`, `postjob/{OfferToSavedHelpr,DirectOfferBanner,useJobFormEffects,usePostJobForm,useJobSubmit,jobSubmitHelpers}`, `ReportDialog.tsx`, `BlockUserDialog.tsx`, `lib/userBlocks.ts`, `lib/shakeToReport.ts`, `SosShareButton.tsx`, `PostedJobActions.tsx`, `RichMessageInput.tsx`, `messageScanner.ts`, `sendHandlers.ts`, `logViolation.ts`, `ChatHeader/ChatView/MessageActionSheet`, `userProfile/ReviewsSection.tsx`, `UserProfile.tsx`, `reviewPanel/*`, `AdminReports.tsx`.

**In scope, covered:** `?tab=saved_helpers` · `entry:offer-saved-helpr` · `/user/:userId` disclosure · `?tab=reviews` · review lockouts and blind period · messaging safety and disintermediation · report/block friction · ban enforcement · abuse rate limits · safety escalation.
