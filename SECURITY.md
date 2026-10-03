# Security Policy

Louisiana Helpr is one codebase (React + TypeScript + Vite, wrapped by Capacitor
for iOS and Android) backed by Supabase (Postgres, row-level security, edge
functions) and Stripe Connect for payments.

## Supported versions

Fixes ship only to the current code. There are no maintained release branches.

| Version | Supported |
| ------- | --------- |
| Web app, as currently deployed from `main` | :white_check_mark: |
| Latest iOS / Android store release (1.0.x) | :white_check_mark: |
| Older store builds | :x: (users are prompted to update) |

## Reporting a vulnerability

Please do not open a public issue, pull request or discussion for a security
problem.

Report it privately, either way:

- **GitHub private vulnerability reporting** (preferred): the Security tab of
  this repository, then "Report a vulnerability".
- **Email:** admin@louisianahelpr.com, with "Security" in the subject.

Please include what is affected (screen, route, edge function, RPC or
workflow), the steps to reproduce it, and what an attacker could do with it.

## Testing rules

- Test only against accounts you own. Never read, change or delete another
  user's data, and stop as soon as you have shown access is possible.
- Never complete a real payment, payout or refund to prove a payment issue;
  describe the request instead.
- No denial-of-service, spam, social engineering or physical attacks.

## Contributors

- Never commit a secret. Server keys live in GitHub Actions secrets and Supabase
  edge-function secrets. Only `VITE_*` values reach the browser bundle, so only
  values that are safe to publish may use that prefix (see `.env.example`).
- Authorization is enforced in the database (RLS policies and `SECURITY
  DEFINER` functions), never by trusting the client.

## Automated checks in this repository

- `secret-scan.yml`: gitleaks on every push and pull request.
- `security-audit.yml`: weekly `npm audit` of the resolved lockfile; production
  dependencies fail at moderate and above.
- CodeQL code scanning on every push to `main`, and
  `code-scanning-alerts.yml`, which fails daily while any CodeQL alert on `main`
  is open or the scan has stopped running.
