# Citrinia

A tiny Twitter-style feed. Posts are called peels. Log in with GitHub, post a
peel, like other people's peels, and watch new peels arrive live.

Built with Next.js 16 (App Router, Turbopack, server actions) and Supabase
(Postgres, auth, realtime). Styling is [StyleX](https://stylexjs.com) compiled at
build time through `babel.config.js` and `postcss.config.js`; there is no
Tailwind and no component library. A custom Babel config disables `next/font`, so
Shrikhand and Nunito are self-hosted in `public/fonts` and declared in
`app/globals.css`. Menus and sheets use the platform's own `popover` attribute
and `<dialog>` rather than a headless UI dependency.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run every file in
   [`supabase/migrations/`](supabase/migrations) in filename order. They create
   the `profiles`, `peels`, and `likes` tables, the signup trigger, row-level
   security policies, and enable realtime on `peels`.

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
pnpm lint        # eslint, including the StyleX rules
pnpm typecheck   # tsc --noEmit
pnpm test        # node --test over lib/
pnpm build       # next build (Turbopack)
pnpm verify:db   # applies the migrations to a throwaway Postgres in Docker and asserts the schema behaves
```
