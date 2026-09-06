# Citrinia seeding runbook (resume from here)

Last updated 2026-09-06 07:05 IST by the orchestrating session. Everything a fresh Claude session needs to continue is in this repo; nothing depends on the old session's scratchpad.

## Where things stand
- App: two feature slices live on https://citrinia.vercel.app (main `d903720`+). Migrations 20260905 (init), 20260906 (core), 20260907000000 (social), 20260907010000 (service-role grants) are all applied on the live Supabase project `nqkvknsgtfeoqqbvqgal`.
- `.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (sb_secret format). Never print it.
- GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set on ankitpasayat/citrinia (owner consented).
- Production already has the **anchor backfill**: 41 AI personas, 690 peels (260 replies), 118 media, 100 reposts, 919 likes, 434 follows, 60 bookmarks. Import state: `seed/.state/live.json` (gitignored; the importer is idempotent without it — peel uuids derive from content ids).
- Content accepted so far (all pass `node seed/validate.mjs`): anchors `india, tech, culture, society` + bulk batches listed by `ls seed/content/bulk-*.json`. Rejected Haiku attempts live in `seed/rejected/` (do not use).
- Owner decisions: 20k peels / 300 personas total; India share about a third (bulk gate 22–38% per batch, `seed/gate-exemptions.json` lists pre-gate batches); drip rate **135 peels/hour**; anchors backfilled first (done); GitHub cron is the drip runner.

## The pipeline
1. **Persona bibles**: `seed/personas/batch-01.md … batch-50.md`, `manifest.json` (300 personas, 105 India-centred).
2. **Media pool**: `seed/media-pool.json` (506 verified items), queried with `node seed/pool.mjs --tags a,b [--kind gif|image|youtube] [--limit 8] [--any]`. Verified URLs are cached in `seed/.urlcache.json` (gitignored; regenerate with `node seed/validate.mjs --check-pool seed/media-pool.json`, ~8 min cold).
3. **Bulk writing**: one Sonnet 5 agent per batch, prompt below, following `seed/docs/SEED-BULK.md` (+ `seed/docs/SEED-BRIEF.md`). Output `seed/content/bulk-NN.json`. Haiku was tried and rejected (fragments, off-topic replies); Opus is fine but slower. Run ~8 agents at a time; each takes 30–50 min.
4. **Validation**: `node seed/validate.mjs` (whole set) and `node seed/validate.mjs --check-urls seed/content/<file>` (format, media, quality gates). Quarantine failures in `seed/rejected/`; never edit accepted files by hand without re-validating.
5. **Import**: `node seed/seed.mjs --target live` backfills everything in `seed/content/` (pauses notification triggers, backdates over three weeks) — DO NOT run this again for bulk batches; use drip. `node seed/seed.mjs --target live --drip 135` publishes the next slice as if it happened in the last hour (replies follow parents on later runs, triggers stay on). Self-test: `node seed/seed.test.mjs`.
6. **Drip schedule**: `.github/workflows/drip.yml` runs hourly with `count` default 135 (see "In-flight work" — verify it exists). Content files must be committed for the workflow to see them.

## Relaunch prompt for a bulk batch (Sonnet 5, background)
> You are writing bulk seed content for Citrinia. Your batch is **NN**. Read `seed/docs/SEED-BULK.md` first and follow it exactly. Specifics: persona file `seed/personas/batch-NN.md`; output `seed/content/bulk-NN.draft` (`"cluster": "bulk-NN"`, ids `bulk-NN-001`… / `bulk-NN-r001`…), validated with `node seed/validate.mjs --check-urls seed/content/bulk-NN.draft` until OK, then `mv` to `bulk-NN.json` and run `node seed/validate.mjs` once more. Media only from `node seed/pool.mjs` output. Report the validator summary line and three favourite peels.

Which batches to run: every NN from 01–50 without a `seed/content/bulk-NN.json`. Delete stray `seed/content/*.draft` files first (they are dead half-writes from a killed session). Sample each finished batch (5 random peels, 3 reply pairs) before trusting it; the gates catch most slop but not all.

## In-flight work when the last session stopped (2026-09-06 ~06:45 IST)
- Bulk batches 14, 15, 16 were being written (09–13 finished and are committed). Their `.draft` files are dead; relaunch them.
- Drip mode is DONE and committed (`bea13cf`): `node seed/seed.mjs --target live --drip 135`, `.github/workflows/drip.yml` runs hourly at :07 with count 135 and was dispatched once by hand on 2026-09-06 ~07:05 IST. Check runs with `gh run list --workflow=drip.yml`; a failing run usually means the secrets or a validator error in a newly committed content file.
- Ongoing: as each bulk batch is accepted, `git add seed/content/bulk-NN.json && git commit && git push` so the hourly drip can see it. The drip skips anything already on production.

## Checks
`pnpm typecheck && pnpm lint && pnpm test && pnpm build`; `supabase/verify.sh` (Docker); `pnpm e2e` (needs `npx supabase start` then `npx supabase db reset`, see README). Owner's dev server usually runs on :3000 — never kill it; Next 16 refuses a second `next dev`, use `next start -p <port>` after a build.

## Still to do after seeding
Daily fresh-content routine (new peels, not just the corpus), pagination tie-break keyset if ties ever matter for real posts, orphan-upload sweep, notifications realtime badge, PWA service worker, Capacitor shell.
