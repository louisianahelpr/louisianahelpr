# Migrating Helpr from Lovable to Replit

This is a checklist for moving the **frontend** to Replit while keeping the existing Supabase backend (database, auth users, edge functions, storage) intact. No data is lost — Supabase lives independently of Lovable.

---

## 1. Export the codebase from Lovable

In Lovable: **GitHub → Connect to GitHub → Push to a new repo**.
Then in Replit: **Create Repl → Import from GitHub → select that repo**.

Alternatively, download the project as a zip and upload to Replit.

---

## 2. Set environment variables in Replit Secrets

Open the **Secrets** tab (lock icon) in Replit and add:

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://steigdwrpkosbiycshwz.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | (anon key — see `.env.example`) |
| `VITE_SUPABASE_PROJECT_ID` | `steigdwrpkosbiycshwz` |

These are public/publishable — safe to commit, but Replit Secrets is cleaner.

---

## 3. Install & run

```bash
npm install
npm run dev
```

The Vite dev server will pick up the secrets as env vars. Default port: `5173` (Replit auto-forwards).

For production:
```bash
npm run build
npm run preview
```

---

## 4. Backend secrets (edge function env vars)

Lovable does NOT expose service-role or 3rd-party API keys to you. You'll need to **regenerate or retrieve** these directly from each provider, then set them in Supabase via:

**Supabase Dashboard → Project Settings → Edge Functions → Secrets**

Required secrets (based on `supabase/functions/`):

- `SUPABASE_SERVICE_ROLE_KEY` — Supabase Dashboard → Settings → API
- `SUPABASE_URL` — same as above
- `STRIPE_SECRET_KEY` — Stripe Dashboard → Developers → API keys
- `STRIPE_WEBHOOK_SECRET` — Stripe Dashboard → Webhooks → your endpoint
- `STRIPE_CONNECT_CLIENT_ID` — Stripe Connect settings
- `LOVABLE_API_KEY` — ⚠️ **This won't work outside Lovable.** Replace AI calls with a direct provider key (e.g. `GEMINI_API_KEY` from Google AI Studio, or `OPENAI_API_KEY`).
- `CRON_SECRET` — generate any random string
- `RESEND_API_KEY` (if you use email)
- Any others your edge functions reference

> ⚠️ The **Lovable AI Gateway** (used by AI Job Builder, etc.) won't work on Replit. You must swap those calls to call Gemini/OpenAI directly.

---

## 5. Edge functions deployment

Replit can't deploy Supabase edge functions. Use the Supabase CLI locally or in a Replit shell:

```bash
npm install -g supabase
supabase login
supabase link --project-ref steigdwrpkosbiycshwz
supabase functions deploy --project-ref steigdwrpkosbiycshwz
```

---

## 6. Database migrations

Migrations in `supabase/migrations/` are already applied to your live DB. Going forward, run new ones with:

```bash
supabase db push
```

---

## 7. Custom domain

Once Replit is hosting the production build:

1. Replit → **Deployments → Custom domain** → add `louisianahelpr.com`
2. Update DNS at your registrar to Replit's targets
3. In Supabase → **Authentication → URL Configuration**, update Site URL & Redirect URLs to point to your new Replit URL
4. Update **Stripe webhook URL** to the new domain
5. Update **OAuth redirect URIs** (Google, Apple) to the new domain

---

## 8. Things that will break and need fixing

- **Lovable AI Gateway** — replace with direct Gemini/OpenAI calls + `GEMINI_API_KEY`
- **Lovable-managed deploy URLs** in code (search for `louisianahelpr.lovable.app`) — update to new domain
- **Capacitor mobile build** — the iOS app web-wrapper points to `louisianahelpr.lovable.app` (see `capacitor.config.ts`); update `server.url` to new domain before next iOS build
- **Email auth redirects** — currently hardcoded to `louisianahelpr.lovable.app`; update in `src/lib/authRedirects.ts`
- **CORS** in edge functions — already permissive (`*`), should be fine

---

## 9. Verify

- [ ] Frontend boots, can sign in
- [ ] Can post a job (Stripe checkout works)
- [ ] Realtime messages work
- [ ] AI Job Builder works (if you swapped the provider)
- [ ] iOS app still loads after `cap sync` with new URL
