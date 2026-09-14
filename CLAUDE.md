# Citrinia

- Before any commit run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `supabase/verify.sh` (needs Docker).
- Treat a source edit as unverified until it is rebuilt: `pnpm e2e` drives a production build served by `next start -p 3210`, never the dev server.
- Bring the e2e stack up with `npx supabase start` then `npx supabase db reset`. `start` restores a cached snapshot, so a migration added since is missing until the reset replays it.
- Apply a prod migration through the Supabase Management API BEFORE pushing app code that depends on it, never after.
- Never kill the owner's dev server on :3000. Next 16 refuses a second `next dev`, so build first and use `next start -p <port>`.
- Keep `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, the deployment environment and Actions secrets only. It bypasses row-level security, so it never reaches a browser.
- Do not reach for `next/font`: the StyleX `babel.config.js` makes Next throw on it. Self-host faces with `@font-face` instead.
- State in the commit body what was verified, with the counts (unit tests, verify:db checks, e2e).
