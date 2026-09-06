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

## End to end

`pnpm e2e` drives the signed-in flows in a real browser with Playwright, as two
users, in one narrative on one database:

- `e2e/mvp.spec.ts` — post, reply, like, follow, search, edit profile, delete,
  theme, and a peel arriving on an open feed.
- `e2e/desktop.spec.ts` — the same feed on a wide screen.
- `e2e/social.spec.ts` — repeel, quote, bookmarks, notifications and the unread
  badge, @mentions and #hashtags, YouTube links, the media picker, cursor
  pagination, the "N new peels" announcement, and who to follow.

GitHub OAuth cannot be completed headlessly, so the suite runs against a
**local** Supabase stack and mints its sessions with the password grant
(`e2e/auth.ts` writes the same cookie `@supabase/ssr` would). It seeds `ada` and
`bob` and resets their data on every run, so it is repeatable.

Docker has to be running. Three terminals, or three steps:

```bash
# 1. The local stack. `start` restores its own cached snapshot, which does not
#    include a migration added since it was last stopped -- so reset after it,
#    which replays supabase/migrations in order and creates the media bucket.
npx supabase start
npx supabase db reset

# 2. A production build wired to it. NEXT_PUBLIC_* values are inlined at build
#    time, so the env has to be set for the build, not just for `next start`.
eval "$(npx supabase status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY)=')"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$PUBLISHABLE_KEY"
pnpm build
pnpm exec next start -p 3210     # port 3210, so `pnpm dev` can keep 3000

# 3. The suite.
pnpm e2e
```

Global setup checks the schema before anything runs and says to reset if the
`reposts`, `bookmarks`, `peel_media` or `notifications` tables — or the `media`
Storage bucket — are not there yet.

One thing the local stack cannot exercise: a file uploaded through the composer
comes back from Storage as `http://127.0.0.1:54321/…`, and both `lib/media.ts`
and the `peel_media_url_https` constraint require `https://`, so the peel is
refused. The upload itself is covered end to end; the card it would produce is
covered from an `https` url, the way the seed importer writes one.

Screenshots land in `e2e/screenshots/` (gitignored) at both sizes. `npx supabase
stop` tears the stack down; starting it again comes up with the data reset.
