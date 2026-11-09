# Helpr — Louisiana Help Marketplace

A dual-sided gig marketplace exclusively for Louisiana. Connects **Posters** (homeowners and small businesses) with **Helprs** (1099 independent contractors) for everyday tasks like cleaning, errands, yard work, moving, and senior help.

- **Live site:** https://www.louisianahelpr.com

## Features

- **Job marketplace** — post jobs, browse open work, apply, accept offers
- **Escrow payments** — Stripe Connect holds funds until job completion
- **Louisiana tax handling** — automatic state + parish sales tax via Stripe
- **Identity verification** — Stripe Identity for helpr onboarding
- **Real-time messaging** — in-app chat with attachments per job
- **Job lifecycle tracking** — Offered → Accepted → On the way → Arrived → Working → Complete
- **Reviews & ratings** — gated to completed jobs only
- **Push notifications** — web push (PWA) and native (iOS) via Capacitor
- **Subscriptions** — Free / Helpr Pro / Helpr Elite / Business tiers
- **Admin dashboard** — moderation, disputes, analytics, broadcasts, ID review queue
- **Native mobile** — iOS builds via Capacitor with Fastlane CI/CD

## Tech stack

- **Frontend:** Vite, React 18, TypeScript, Tailwind CSS, shadcn/ui, framer-motion
- **Backend:** Supabase — Postgres + RLS, Auth, Storage, Edge Functions
- **Payments:** Stripe Connect (Express), Stripe Identity, Stripe Checkout with automatic tax
- **Mobile:** Capacitor 8 (iOS), Fastlane for App Store releases
- **PWA:** vite-plugin-pwa with workbox

## Local development

```sh
# 1. Clone
git clone <YOUR_GIT_URL>
cd louisianahelpr

# 2. Install
npm install

# 3. Start dev server (http://localhost:8080)
npm run dev
```

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build |
| `npm run build:dev` | Development-mode build (keeps console logs) |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run preview` | Preview the production build locally |

### Environment

Supabase connection values live in `.env` (see `src/integrations/supabase/client.ts`). `src/integrations/supabase/types.ts` is generated from the database schema via the Supabase CLI (`supabase gen types`) — regenerate it rather than editing by hand.

## Native mobile (Capacitor)

```sh
# After git pull, sync web build into native projects
npm run build
npx cap sync

# Open native IDEs
npx cap open ios       # requires macOS + Xcode
```

App ID: `com.Helpr`. See `docs/CICD_AND_ASO.md` and `fastlane/` for release automation.

## Deployment

The web app deploys to Vercel via `.github/workflows/prod-deploy.yml` (batched; a push to `main` alone does not trigger a deploy — `vercel.json` has `git.deploymentEnabled: false`). Supabase edge functions deploy
via `.github/workflows/functions-deploy.yml` when `supabase/functions/**` changes.
Native iOS releases go through Fastlane (see `docs/CICD_AND_ASO.md`).

## 25 Days of Louisiana Giveaways (sponsor page)

The sponsor page is `/sponsor` (also `/25days`). Its rules page is `/25days/rules`, and the admin is `/admin/sponsors`.

- **Turning it on.** Everything stays dark until the `sponsor_25days` switch is flipped in Admin → Settings → Hidden
  Feature Switches. While it is **Off**, both pages show "Not found" and the sign-up refuses. Set it to **Testers** to
  set things up: then only admins and test accounts can see the page. Set it to **Everyone** when brands should see it.
- **Adding a brand and copying its link.** Go to /admin/sponsors → **Links**, type the brand name (the email is
  optional) and press **Create link**. You get `https://www.louisianahelpr.com/sponsor?ref=<brand-name>` and it is
  copied for you. A brand that opens its link is greeted by name and the brand name is filled in on the form. The same
  table shows each link's visits, its first and last visit, and whether that brand signed up.
- **Editing the words.** Every word on both pages is in `src/content/sponsorPage.ts`. Text in `[square brackets]`
  is a placeholder. The card, line, button or question that holds one stays hidden until you replace the brackets
  with the real value. The Facebook Group button, for example, appears once `links.facebookGroup` is a real URL. Never
  fill a placeholder with a made-up number, review or logo. The rules page shows a **DRAFT** banner until
  `rules.approved` is set to `true` (only allowed once no `[placeholder]` is left in `rules`). The browser-tab title
  and the link-preview text are in `src/lib/publicPageMeta.mjs` (`NOINDEX_PAGE_META["/sponsor"]`). The preview picture
  is `public/og-25days.png`.
- **Editing the stats, founder photo and testimonials.** Use /admin/sponsors → **Page content**. A stat left blank is
  hidden. Add a testimonial only with a real sponsor's own words; it shows once you tick **Approved**.
- **Changing the cap.** Use /admin/sponsors → **Page content** → **Max sponsors per day**. Leave it blank for no limit.
  The server enforces the cap: a full day shows "Full" and refuses new sign-ups. Sponsors you add by hand, or move,
  are not capped.
- **Exporting sign-ups.** Use /admin/sponsors → **Sign-ups** → **Export CSV**. The export includes every column, and
  the day and status filters apply to it.
- **Behind the page.** The data lives in the `sponsor_*` tables (migration `20261109162829_sponsor_25days.sql`). No
  browser can read them. The public page reads counts only, through `sponsor_public_state`. Sign-ups go through the
  `sponsor-25days` edge function, which checks the honeypot, the rate limit and the input, then emails a
  confirmation to the brand and the details to admin@. Logos are in the private `sponsor-logos` bucket. No new
  environment variables are needed: it uses the existing `RESEND_API_KEY` and the optional `SUPPORT_INBOX_EMAIL`.
- **Local preview.** On `npm run dev` only, add `?demo=1` to the URL to see the page with made-up sample data. Add
  `&ref=cajun-candle-co` for the greeting, `&fill=1` for the stats and sponsor wall, `&placeholders=1` to highlight
  the placeholders, and `&cap=1` for full days. Built bundles never contain the sample data.

## Contributing

Land changes with `bash scripts/land.sh` (branch + PR; a direct push to `main` is
refused). Ensure `npm run typecheck`, `npm run lint`, and `npm run build` all pass.
See `CLAUDE.md` for the full working rules.
