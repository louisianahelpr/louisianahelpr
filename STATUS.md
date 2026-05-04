# Overnight status — 2026-05-03

Lexi — followed up on your "go through all pages and update" with a systematic pass tonight. Here's what changed and what's still on the list when you're awake.

---

## ✅ Done tonight (working tree, not committed)

### Landing page polish (the original 4)
1. **HowItWorks linen container removed** — `src/components/landing/HowItWorksSection.tsx`. Champagne now flows through; trust strip rewrapped in `.liquid-glass`.
2. **App Store + Play Store badges** below the phone cluster — `src/components/landing/HeroSection.tsx`. Live App Store URL; Play marked "coming soon".
3. **Secondary CTA contrast bumped** — Bark border + Bark text on white/45 frosted background.
4. **Mobile audit** — see "known issues" below.

### Auth flow refresh — complete
Built a shared `src/components/auth/AuthShell.tsx` so all auth/status pages share the same parchment + mesh background, italic Bodoni "Helpr·LA" wordmark, and editorial eyebrow + headline pattern. All these pages have been rewritten on top of it:

- **Login** (`src/pages/Login.tsx`) — liquid-glass card, Bark CTA, "Glad you're back." display H1, italic eyebrow.
- **Signup** (`src/pages/Signup.tsx`) — wrapped in AuthShell, liquid-glass surface, italic step-counter eyebrow + Bodoni step headlines. Step content untouched (kept all field validation, file upload, business signup logic intact).
- **ForgotPassword** — full rewrite. "We'll send you a link." display headline + Burnt-Sienna mailbox icon for the success state.
- **ResetPassword** — same treatment.
- **SignupPending** — full rewrite as AuthShell. Three numbered "what happens next" steps with Bark icons.
- **AccountPending** — wordmark refreshed in header; primary CTA now Bark.
- **AccountDenied** — full rewrite, Burnt-Sienna XCircle, Bodoni "We couldn't approve your account." headline.
- **AccountBanned** — full rewrite, Burnt-Sienna Ban icon, structured suspension card.
- **PaymentSuccess** — full rewrite, Bark CheckCircle, escrow callout, Bodoni headline.
- **NotFound** — full rewrite, big italic 404, Bark "Back to home" CTA.
- **CompleteProfile** — page wrapper updated to parchment + mesh; headline now editorial italic Bodoni "Almost there.". Form/checklist body untouched.

### App pages (logged-in surface) — token-level refresh
Rather than rewriting each massive page individually (Dashboard 758 lines, Profile 1206 lines, PostJob 1110 lines, etc.), I made global utility-class updates that propagate through every page using them:

- **Defined `.bg-premium-page`** in `src/index.css`. This was a ghost class (referenced in ~15 pages but undefined). Now resolves to a champagne linear gradient identical to the landing canvas. Single change refreshes Dashboard, Profile, Activity, Messages, Jobs, JobHistory, Schedule, Availability, SavedHelpers, Support, and all legal pages.
- **Updated `.text-page-title` + `.text-section-title`** to Bodoni Moda 700 italic with clamp sizing — used `!important` to defeat the trailing `text-2xl` legacy class on call sites without rewriting every h1. Refreshes all section/page headings throughout Profile tabs, Activity, Messages, Support, Schedule, etc.
- **`PageHeader.tsx` headline** now renders in italic Bodoni — propagates to PostJob, Schedule, JobHistory, UserProfile, DataRights.
- **Wordmark replacements** — all four occurrences of the old gradient "Helpr" wordmark (Dashboard, DashboardGuest, Profile, Admin) now use the italic "Helpr·LA" pattern with Burnt-Sienna LA.
- **Targeted h1 rewrites** — Dashboard greeting, Jobs "Browse tasks", Messages, Activity "My Posts/Jobs", Profile name header, SavedHelpers, BusinessTeam, Availability, PrivacyPolicy, PlatformRules, TermsOfService.
- **PostJob form** — added an editorial eyebrow + Bodoni "What do you need done?" intro on the form step.
- **ForBusiness** — full design refresh: parchment + mesh background, Bodoni headline with Burnt-Sienna emphasis, liquid-glass feature tiles, glass CTA card with Bark Building2 logo and Bark "Sign up as a business" button.
- **BusinessTeam** — page background switched from old gradient to `bg-premium-page`, business name in italic Bodoni.

### What I did NOT touch in app pages (deliberate)
- Internal cards, modals, tables, form controls — they inherit from tokens correctly already.
- Profile page tab bodies (Earnings, Reviews, Subscription, etc.) — they pick up the new `.text-section-title` style automatically.
- Admin operational pages — too risky to redesign without verification, and they're internal-only.
- Edge function code — Stripe integration audit was already done last night.

---

## ⚠️ Mobile — still your eye

I didn't rerun the mobile audit during this pass. The same notes from last night apply:

1. Phone cluster on <375px screens — fixed pixel widths may overlap on 320px Android.
2. Status pill on mobile — top-20 right-5 might crowd the hamburger menu on phones.
3. Hero `items-center` on tablet — slightly uneven top/bottom whitespace.

Open at 375px in DevTools and screenshot anything that looks broken — I'll fix per-screen.

---

## 💳 Stripe + integrations — unchanged from last night

The audit from last night holds. To recap the verification steps you still need to run:

1. Supabase dashboard → Edge Functions → Settings → confirm `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set.
2. Stripe dashboard → Developers → Webhooks → confirm webhook URL points to `https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/stripe-webhook`.
3. Run a test transaction with a 4242-4242-4242-4242 card.
4. Tail edge function logs: `npx supabase functions logs stripe-webhook --tail`.
5. Test Connect onboarding flow with a test helper account.

---

## 🐛 Known minor issues (carry-over, not blockers)

- Pre-existing `vite.config.ts` TS error about `esbuild.drop` — unrelated.
- Pre-existing Tailwind ambiguous-class warnings on `ease-[cubic-bezier(...)]` in Button CVA — vendor file.
- React Router future-flag warnings (v7_startTransition, v7_relativeSplatPath) — non-blocking.
- DialogContent a11y warning from the mobile sheet (Radix dialog without explicit DialogTitle) — minor.

---

## 📝 What I'd do first when you're awake

1. **Open `localhost:8080` and click through the auth flow** — `/login`, `/signup`, `/forgot-password`, `/account-pending`. Visual sanity check the new AuthShell pattern. ~5 min.
2. **Click into Dashboard, Profile, Activity, Messages, PostJob** — confirm the new italic Bodoni headers and parchment canvas read consistently. Look for any weird overlap from `.bg-premium-page` now applying a gradient where pages assumed flat. ~5 min.
3. **Verify Stripe** with a test transaction (steps in the section above). ~15 min.
4. **Tell me which page needs more attention** — I avoided rewriting the heaviest pages (Profile internals, PostJob steps 2/3, Activity tabs). If any feel under-loved, point me at one and I'll do a deeper pass.

Nothing is committed. `git status` to review the diff. I'd recommend a single commit for the AuthShell + auth pages, and a separate one for the global token updates (`.bg-premium-page`, `.text-page-title`, `PageHeader.tsx`) — that gives clean rollback granularity if either set causes issues.

Sleep well.
