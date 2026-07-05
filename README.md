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

The web app deploys to Vercel on push to `main`. Supabase edge functions deploy
via `.github/workflows/functions-deploy.yml` when `supabase/functions/**` changes.
Native iOS releases go through Fastlane (see `docs/CICD_AND_ASO.md`).

## Contributing

Branch off `main`, open a PR, and ensure `npm run typecheck`, `npm run lint`, and
`npm run build` all pass before requesting review.
