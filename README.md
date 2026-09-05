# Citrinia

A tiny Twitter-style feed. Posts are called peels. Log in with GitHub, post a
peel, like other people's peels, and watch new peels arrive live.

Built with Next.js (App Router, server actions), Supabase (Postgres, auth,
realtime), Tailwind, and shadcn/ui components.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run
   [`supabase/migrations/20260905000000_init.sql`](supabase/migrations/20260905000000_init.sql).
   It creates the `profiles`, `peels`, and `likes` tables, the signup trigger,
   row-level security policies, and enables realtime on `peels`.

### 2. GitHub OAuth

1. Create an OAuth app at <https://github.com/settings/developers>.
   Set the callback URL to `https://<your-project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase, under Authentication -> Providers -> GitHub, enable the provider
   and paste the client ID and secret.
3. Under Authentication -> URL Configuration, add `http://localhost:3000/auth/callback`
   to the redirect URL allowlist (and your production URL later).

### 3. Environment

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### 4. Run

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>, log in with GitHub, and post something.

## Checks

```bash
pnpm lint
npx tsc --noEmit
pnpm build
supabase/verify.sh   # applies the migration to a throwaway Postgres in Docker and asserts the schema behaves
```
