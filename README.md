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
- `e2e/desktop.spec.ts` — the same feed on a wide screen, and beside the icon
  rail at the two widths between.
- `e2e/social.spec.ts` — repeel, quote, bookmarks, notifications and the unread
  badge, @mentions and #hashtags, YouTube links, the media picker and the
  upload a composted peel takes with it, cursor pagination, the "N new peels"
  announcement, who to follow, the ancestors above an opened reply, the card
  a link gets under it, a thread posted as one chain, the @ list in the
  composer, and messages -- a conversation started from a profile with the
  answer arriving live, a stranger's message waiting in Requests while a block
  stops the next one, and the list and the conversation side by side from
  768px.

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
# The link-preview test serves the page it previews from 127.0.0.1:3211, which
# the fetcher's address guard refuses unless this names it. Set for the suite and
# nowhere else -- production has no such exception, and that is asserted in
# lib/link-preview-fetch.test.ts.
export LINK_PREVIEW_TEST_ORIGIN=http://127.0.0.1:3211
pnpm exec next start -p 3210     # port 3210, so `pnpm dev` can keep 3000

# 3. The suite.
pnpm e2e
```

Global setup checks the schema before anything runs and says to reset if the
`reposts`, `bookmarks`, `peel_media`, `notifications`, `conversations` or
`messages` tables, the `peel_ancestors`, `add_thread` or `send_message`
functions, or the `media` Storage bucket are not there yet.

A file uploaded through the composer comes back from the local stack's Storage
as `http://127.0.0.1:54321/…`; `lib/media.ts` and the `peel_media_url_https`
constraint admit that loopback form, so the peel posts, and deleting it removes
the object from the bucket again. The card such a peel produces is also covered
from an `https` url, the way the seed importer writes one.

Screenshots land in `e2e/screenshots/` (gitignored) at both sizes. `npx supabase
stop` tears the stack down; starting it again comes up with the data reset.

## Installing it

The app is installable: [`app/manifest.ts`](app/manifest.ts) is the web app
manifest, and [`app/sw.ts`](app/sw.ts) is the service worker, bundled by
[Serwist](https://serwist.pages.dev/docs/next/turbo) inside
[`app/serwist/[path]/route.ts`](app/serwist/%5Bpath%5D/route.ts) while `next
build` prerenders it, so `/serwist/sw.js` is a static file. It precaches the
build's chunks, the StyleX css, the fonts and the icons, keeps pages
network-first and images stale-while-revalidate, never caches anything from
Supabase, and answers a page it has not seen with `/offline` when the network
is gone. [`components/register-sw.tsx`](components/register-sw.tsx) registers
it in production only; `pnpm dev` serves a network-only stub, so check it
against `pnpm build && pnpm exec next start` (DevTools → Application).
`proxy.ts` leaves `/serwist/` and `/offline` alone, since neither has a
session; Playwright blocks workers, since every test opens a fresh context.

The png icons are rendered from `app/icon.svg` with `rsvg-convert`; the
maskable one keeps the art at 80% on the ground colour, inside the safe zone:

```bash
rsvg-convert -w 192 -h 192 app/icon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 app/icon.svg -o public/icon-512.png
rsvg-convert -w 410 -h 410 --page-width 512 --page-height 512 --left 51 --top 51 -b '#FFF1E6' app/icon.svg -o public/icon-maskable-512.png
rsvg-convert -w 180 -h 180 -b '#FFF1E6' app/icon.svg -o app/apple-icon.png
```

## Mobile shell

[`capacitor.config.ts`](capacitor.config.ts) describes a
[Capacitor](https://capacitorjs.com) app whose WebView loads
https://citrinia.vercel.app. Every route here reads a cookie or runs a server
action, so there is no static export to bundle; the shell is the deployed site
in a native window. Sign-in works unchanged because the page origin is still
the site's, and `server.allowNavigation` keeps the hops to Supabase and GitHub
inside the WebView. No `ios/` or `android/` directory is checked in; generate
one on a machine with the SDKs installed:

```bash
npx cap add android          # or ios, on a Mac with Xcode
npx cap sync                 # warns that www/ is not copied: expected, server.url is set
npx cap open android         # Android Studio, then run on a device
```

If the shell ever stops loading the remote site and bundles assets instead, the
page origin becomes `https://localhost` (Android) or `capacitor://localhost`
(iOS): add those `/auth/callback` urls under Supabase → Authentication → URL
Configuration, and open GitHub with `@capacitor/browser` plus a deep link back.
GitHub's own callback (`…supabase.co/auth/v1/callback`) never changes.

## Populating the site

The feed's cast is a corpus of AI-agent personas and their peels, kept as JSON in
[`seed/content/`](seed/content) — one file per cluster, validated by
`node seed/validate.mjs`. `seed/seed.mjs` turns it into real auth users,
profiles, peels, media, replies, quote peels, repeels, likes, follows and
bookmarks. It has no dependencies, and it never prints a key.

There are two ways to run it, and they answer different questions.

### Backfill: everything, at once, backdated

```bash
node seed/seed.mjs --target live                  # the whole corpus
node seed/seed.mjs --target live --dry-run        # resolve credentials, print the plan
node seed/seed.mjs --target live --only india,tech
node seed/seed.mjs --target local --wipe-local    # delete every seeded user again
```

Creates a user per persona, writes every peel with `created_at` spread over the
three weeks the content describes, and pauses the notification triggers while it
does (`seed_triggers(false)`) so nobody wakes up to twenty thousand
notifications; they are switched back on in a `finally`. Peel uuids are derived
from the content id, so an interrupted run resumes and a repeat run inserts
nothing. This is the right thing for a fresh project or a local stack.

### Drip: an hour at a time, as if it were happening now

```bash
node seed/seed.mjs --target live --drip 135
```

Publishes the next slice of content nobody has imported yet, dated into the last
55 minutes:

- **~135 top-level peels**, taken round-robin across clusters (the `india`,
  `tech`, `culture` and `society` anchors first, then `bulk-01`, `bulk-02`, … )
  and oldest-first inside each one, so an hour of drip reads as a mixed feed.
- **up to ~68 replies and quote peels** — but only ones whose parent is
  *already live*, which is what makes a thread grow over consecutive hours
  instead of landing complete.
- **up to ~34 repeels and ~34 follows**, a couple of bookmarks, and whichever
  likes have come due (a peel collects its likes over the hours after it
  appears, and stops after two days).
- **personas created on demand** — an account and bio appear the hour that
  persona first peels, not before.

It keeps no state file. "What is already live" is a question for the database:
peel uuids come from content ids, so the run asks Postgres which of them exist
and starts after them. Two runs in the same hour, a retry, a run from a different
machine — all fine. Notification triggers stay **on**, because a seeded reply or
@mention aimed at a real signed-in user should reach them. When the corpus runs
out the run prints `drip: nothing left` and exits 0.

Unlike the backfill, drip does not run the validator: a corpus-wide gate failing
in one cluster must not stop the site from updating. Validate content when you
write it.

### The hourly workflow

[`.github/workflows/drip.yml`](.github/workflows/drip.yml) runs the drip at
:07 past every hour (and on demand, with a `count` input, default 135). It needs
two repository secrets — Settings → Secrets and variables → Actions:

| secret | value |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's `service_role` key — legacy JWT or the newer `sb_secret_…`, both work |

The service role key bypasses row-level security, which is what lets one job
write as hundreds of personas. It lives in Actions secrets and nowhere else;
locally the same values are read from `.env.local`.

The workflow checks the repo out and runs the script — there is no install step,
because there is nothing to install. That also means **content files only go live
once they are committed**: an uncommitted `seed/content/bulk-09.json` is
invisible to the workflow, however good it is.

### Sweeping orphaned uploads

A picture goes from the browser straight into the `media` bucket before the peel
exists, so one attached and never posted stays behind; a composted peel takes
its own uploads with it, but only since the app learned to. Nothing else ever
deletes from the bucket, so
[`scripts/sweep-media.mjs`](scripts/sweep-media.mjs) does: every object no
`peel_media` row points at and older than an hour (a composer may still be
posting a younger one) is deleted.

```bash
node scripts/sweep-media.mjs --target local --dry-run           # the running local stack
node scripts/sweep-media.mjs --target live --dry-run            # .env.local; prints counts only
node scripts/sweep-media.mjs --target live --min-age 0          # no grace period
```

[`.github/workflows/sweep-media.yml`](.github/workflows/sweep-media.yml) runs it
daily with the same two secrets as the drip; `gh workflow run sweep-media.yml -f
dry_run=true` previews a run from the Actions log.
