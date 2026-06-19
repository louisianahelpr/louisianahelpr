# Cross-Cutting Audit — Performance, Accessibility, Content, SEO, Email

Phases 6 (content/voice), 7 (accessibility), 8 (performance), 9 (cross-platform),
12 (email), 13 (SEO). Authored directly by the coordinator (not a fork).

Severity key: Blocker / High / Medium / Low

---

## Phase 8 — Performance

Production `dist/assets` chunk sizes (latest build):

| Chunk | Size | Loaded when | Verdict |
|---|---|---|---|
| jspdf.es.min | 392 KB | dynamic import("jspdf") only | OK — code-split |
| CartesianChart (recharts) | 256 KB | charts routes | Medium — lazy via route chunk |
| Activity | 220 KB | /my-jobs, /my-posts | Medium — large page chunk |
| supabase | 200 KB | app shell | vendor, unavoidable |
| html2canvas | 196 KB | dynamic import (PDF export) | OK — code-split |
| posthog | 192 KB | idle-init after first paint | OK — deferred |
| leaflet | 152 KB | map route chunks | Medium — see F-PERF-02 |
| PostJob | 140 KB | /post-job | Medium |
| motion (framer) | 136 KB | app shell | vendor |

**F-PERF-01 (Low) — PDF export deps are correctly lazy-loaded.**
EarningsExport.tsx:193 and business/BusinessReports.tsx:155 use dynamic
import("jspdf")/import("jspdf-autotable"); combined ~588 KB never lands on the
critical path. No action.

**F-PERF-02 (Medium) — Two mapping stacks ship simultaneously.**
BrowseMap.tsx, TrackingMap.tsx, dashboard/JobMapView.tsx use Leaflet (152 KB) for
interactive maps; useMapKitJs.ts + postjob/AppleMapPreview.tsx/AddressAutocomplete.tsx
use Apple MapKit JS for geocoding/autocomplete/preview. Both legitimate but roadmap
implied a single stack. Fix: track a consolidation spike (MapKit can render
interactive maps). Defer post-launch.

**F-PERF-03 (Medium) — Activity route chunk is 220 KB.**
/my-jobs and /my-posts both resolve to Activity. Fix: React.lazy-split the tabbed
sub-views (PostedJobsTab, AppliedJobsTab, dialogs) by tab. Defer; medium win.

---

## Phase 7 — Accessibility

Clean bill on the two highest-frequency a11y defects:
- Images: all 6 `<img>` tags flagged by a no-alt-on-same-line scan
  (AttachmentLink.tsx:55, MessageAttachment.tsx:249, admin/AdminCredentialQueue.tsx:330,
  admin/AdminBusinessVerificationQueue.tsx:223, profile/SavedHelpersTab.tsx:506,
  profile/SupportInline.tsx:309) are multi-line tags with alt on the following line —
  verified false positives. No alt-less images.
- aria-label coverage: 166 of 440 .tsx files use aria-label.

No new blocker-level a11y findings from the static pass. Live keyboard-trap /
focus-order / contrast checks belong to the Playwright + manual device pass owned by
the per-screen fork.

---

## Phase 6 — Content / Code Hygiene

**F-HYG-01 (Low) — console.* calls are disciplined.** 67 occurrences outside tests;
all are console.error("[Component] …", error) failure logging or DEBUG_AUTH-guarded
console.log. No noisy unguarded debug logs ship to users.

**F-HYG-02 (Low) — Only 1 TODO/FIXME in src/.**

**F-TYPE-01 (Medium) — 385 any/as any usages.** Concentrated: UserProfile.tsx (28),
activity/PostedJobsTab.tsx (23), Community.tsx (17 — dead page, ignore),
activity/useActivityActions.ts (14), business/BusinessApi.tsx (13), BusinessTeam.tsx (12),
business/BusinessReports.tsx (12). Why: any silences the compiler around Supabase row
shapes/event handlers — where a renamed column/RPC would otherwise fail at build. Fix:
incrementally replace with generated Database[...]["Row"] types. Not a launch blocker.

---

## Phase 13 — SEO

**F-SEO-01 (High) — sitemap.xml lists only 5 URLs; ~20+ public marketing pages omitted.**
public/sitemap.xml lists /, /browse, /for-business, /legal, /data-rights. App.tsx
exposes many public indexable routes not in the sitemap: /how-it-works,
/become-a-partner, /benefits, /enterprise, /family, /pets, /parishes, /impact,
/pay-it-forward, /evacuation, /insurance-claim, /discharge, /help, /home-history,
/work-record, /time-credits, /wrapped, /availability. Why: these landing pages carry
the local-SEO long-tail the rich JSON-LD + geo-meta are built to rank. Fix: regenerate
sitemap.xml from the public-route list (script off the route table so it can't drift),
excluding auth-gated and redirect-stub routes; verify each candidate is genuinely
public (not behind ProtectedRoute) before listing.

**F-SEO-02 (Low) — Core SEO infra is mature.** index.html has complete OG + Twitter
cards, canonical, geo-meta (US-LA), Apple Smart App Banner, LocalBusiness + Organization
JSON-LD with areaServed city list, theme-color, manifest. robots.txt allows all +
points to sitemap.

---

## Phase 12 — Email

Server-side via Supabase edge functions (no client secret exposure): auth-email-hook,
send-account-status-email, send-business-invite-email, send-notification-email,
send-marketing-blast, process-email-queue, admin-resend-verification, admin-update-email,
email-tracking, engagement-automations. Resend integration lives only in function code.
Deep deliverability review (SPF/DKIM/DMARC, templates, unsubscribe, queue retry) is
delegated to the security/store-readiness fork (Phases 4+14); cross-reference
04-security-money.md for the email-secrets verdict.

---

## Phase 9 — Cross-Platform (Capacitor)

Covered structurally by the per-screen fork (AppShell/safe-area/native-surface
inventory). Coordinator note: index.html ships a Capacitor-only CSP meta tag (stripped
from the web build by the html-strip-meta-csp Vite plugin) — correct handling of the
file:// vs Vercel-header CSP-intersection gotcha, already documented inline. No new finding.
