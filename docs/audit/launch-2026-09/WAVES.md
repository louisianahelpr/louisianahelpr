# Wave schedule — 33 lanes, 3 concurrent

Grouping is contention-aware, not arbitrary. Three rules drive it:

1. **At most 3 agents in flight** (standing project rule — larger fan-outs slow the machine).
2. **At most one lane per wave may use the canonical seeded account**
   (`eli.test.helper@louisianahelpr.com`). Every other mutating lane
   **self-provisions its own test account** — a sweep that mutated the shared seeded
   account once left `push_enabled=false` and all 7 `helper_availability` rows disabled,
   and several later audits read that as a product defect.
3. **The gates are serialized.** Never two `typecheck` / `vitest` / `lint` runs at once.
   Ask the orchestrator for the gate.

`M` = mutating · `S` = uses the canonical seeded account · `D` = needs a device or simulator

| Wave | Lanes | Notes |
|---|---|---|
| **0** | *orchestrator only* | Pre-flight: migration drift, `gh workflow list --all`, `npm run check:launch`. **If prod deploys are red, stop** — everything downstream is moot. |
| **1** | `lh-schema-integrity` · `lh-silent-failure` · `lh-route-walker` `S` | Static + live-DB + read-only route walk. Establishes the baseline everything else references. |
| **2** | `lh-authz-rls` · `lh-edge-functions` · `lh-webkit-differ` | Two backend read-only lanes + the WebKit A/B. |
| **3** | `lh-money-escrow` `M` · `lh-cron-jobs` · `lh-native-bridge` `D` | The money lane gets its own accounts and Stripe **test mode**. |
| **4** | `lh-state-matrix` `M` `S` · `lh-onboarding-auth` `M` · `lh-build-release` | State matrix owns the seeded account this wave; onboarding creates fresh accounts by definition. |
| **5** | `lh-e2e-journeys` `M` · `lh-trust-safety` `M` · `lh-verification-credentials` `M` | Three own-account lanes; E2E needs two accounts of its own. |
| **6** | `lh-admin-moderation` `M` · `lh-notifications` `M` · `lh-concurrency-cache` `M` | Admin actions are logged — check `admin_audit_log` residue afterwards. |
| **7** | `lh-scheduling-time` `M` · `lh-subscriptions-credits` `M` · `lh-input-boundary` `M` | Heavy writers. Restore state and confirm clean before the wave closes. |
| **8** | `lh-visual-critic` · `lh-a11y-sensory` · `lh-browse-discovery` | Judgment + measurement lanes, running on the wave-1 screenshot corpus. |
| **9** | `lh-long-tail-features` `M` · `lh-copy-content` · `lh-email-delivery` `M` | |
| **10** | `lh-perf-deps` · `lh-observability` · `lh-compliance-store` | Perf needs a quiet machine — do not stack other browser lanes here. |
| **11** | `lh-test-ci` · `lh-suggester` | Suggester reads `ROLLUP.md` — it must run after the sweep. |
| **12** | `lh-verifier` **alone** | Reproduces or retracts everything, audits coverage, writes `VERDICT.md`. |

---

## If you need to ship sooner: the critical path

**12 lanes over 4 waves plus the verifier.** These are the lanes where a miss means real
money moves wrongly, a stranger gets unverified access to someone's home, or the app is
rejected. Everything else improves the product; these gate the launch.

| Wave | Lanes |
|---|---|
| **C1** | `lh-schema-integrity` · `lh-silent-failure` · `lh-authz-rls` |
| **C2** | `lh-money-escrow` · `lh-edge-functions` · `lh-cron-jobs` |
| **C3** | `lh-e2e-journeys` · `lh-trust-safety` · `lh-verification-credentials` |
| **C4** | `lh-native-bridge` · `lh-compliance-store` · `lh-state-matrix` |
| **C5** | `lh-verifier` alone |

The remaining 20 lanes then run as a second pass — cohesion, polish, performance,
copy, long-tail features and the suggestions — without blocking the ship decision.

## Lifting the concurrency limit

At 5 concurrent the full sweep drops from 12 waves to about 7. The costs are real:
gate contention (`typecheck`/`vitest`/`lint`), and more mutating lanes in flight at once
against a finite pool of test accounts. If you want this, raise it in waves 8–11 (the
read-mostly lanes) and leave waves 3–7 at 3.
