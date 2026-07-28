# AGENTS.md

**Repository:** [vizartid/Vizora-Capital](https://github.com/vizartid/Vizora-Capital)

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **Vizora Capital** (API base `https://uyi4ynjx.ap-southeast.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (via vinext) |
| UI | React 19, Tailwind CSS 4, Lucide Icons |
| Language | TypeScript 5.9 (strict, ESM) |
| Database | PostgreSQL via InsForge + Drizzle ORM |
| Auth | InsForge Auth (email/password, Google OAuth) |
| AI | OpenAI SDK via OpenRouter (Gemini models) |
| Payments | Midtrans (sandbox + production) |
| Hosting | Cloudflare Workers (vinext + Wrangler) |
| Build | Vite 8 |

## Project Structure

```
app/
  (dashboard)/       # Authenticated routes (invoices, customers, chat, settings)
  api/               # API routes (auth, payments, webhooks)
  components/        # Shared UI components (AppShell, EntryViews, WorkspaceViews)
  providers/         # VizoraProvider context (session, business, membership)
  lib/               # Utility modules (InsForge client, payment config, finance types)
  login/             # Login page
  signup/            # Signup page
  onboarding/        # Business onboarding flow
  pricing/           # Pricing page with Midtrans checkout
functions/           # InsForge edge functions (finance-api, invoice-owner-reminders)
migrations/          # SQL migration files
scripts/             # Setup and smoke-test scripts
tests/               # Rendered HTML test suite
```

## Coding Conventions

- TypeScript strict mode, no `any`, ESM throughout
- React functional components with hooks, no class components
- Tailwind utility-first CSS, no inline styles
- Lucide React for all icons
- Server actions and API routes handle mutations
- AI outputs are always drafts requiring human approval
