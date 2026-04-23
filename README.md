# Helpr — Louisiana Help Marketplace

A dual-sided gig marketplace exclusively for Louisiana. Connects **Posters** (homeowners and small businesses) with **Helprs** (1099 independent contractors) for everyday tasks like cleaning, errands, yard work, moving, and senior help.

- **Live site:** https://www.louisianahelpr.com
- **Lovable project:** https://lovable.dev/projects/215189c5-272d-4716-babd-430ab4187c14

## Features

- **Job marketplace** — post jobs, browse open work, apply, accept offers
- **Escrow payments** — Stripe Connect holds funds until job completion
- **Louisiana tax handling** — automatic state + parish sales tax via Stripe
- **Identity verification** — Stripe Identity for helpr onboarding
- **Real-time messaging** — in-app chat with attachments per job
- **Job lifecycle tracking** — Offered → Accepted → On the way → Arrived → Working → Complete
- **Reviews & ratings** — gated to completed jobs only
- **Push notifications** — web push (PWA) and native (iOS/Android) via Capacitor
- **Subscriptions** — Basic / Pro / Elite tiers for helprs
- **Admin dashboard** — moderation, disputes, analytics, broadcasts, ID review queue
- **Native mobile** — iOS + Android builds via Capacitor with Fastlane CI/CD

## Tech stack

- **Frontend:** Vite, React 18, TypeScript, Tailwind CSS, shadcn/ui, framer-motion
- **Backend:** Lovable Cloud (Supabase) — Postgres + RLS, Auth, Storage, Edge Functions
- **Payments:** Stripe Connect (Express), Stripe Identity, Stripe Checkout with automatic tax
- **Mobile:** Capacitor 8 (iOS + Android), Fastlane for App Store / Play Store releases
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

The Supabase client and `.env` are managed automatically by Lovable Cloud. Do **not** edit `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, or `.env` manually — they are regenerated.

## Native mobile (Capacitor)

```sh
# After git pull, sync web build into native projects
npm run build
npx cap sync

# Open native IDEs
npx cap open ios       # requires macOS + Xcode
npx cap open android   # requires Android Studio
```

App ID: `com.louisianahelpr.app`. See `docs/CICD_AND_ASO.md` and `fastlane/` for release automation.

## Deployment

Push to `main` is automatically deployed by Lovable. To publish a new version, open the project in Lovable and click **Share → Publish**, or use a custom domain via **Project → Settings → Domains**.

## Contributing

This repo is bidirectionally synced with Lovable. Changes pushed to GitHub appear in the Lovable editor and vice versa.
