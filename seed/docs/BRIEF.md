# Citrinia build brief (read fully before touching code)

Repo: /home/ankit/Code/citrinia. Owner: Ankit. You are one of several agents building slices in parallel. Stay inside your slice's files. **Never run `git commit`, `git add`, `git stash`, `git checkout`, or any pnpm install/remove.** Do not add dependencies. Do not edit files owned by another slice (listed per task) — if you need a change there, describe it in your final report instead.

## Product
A tiny Twitter-style feed. Posts are **peels**. Users log in with GitHub (Supabase Auth). Voice: "Peel it" (post button), "No peels yet" (empty), "That peel got composted." (404), "how are you peeling?" (composer placeholder). Say peel, not post.

Core MVP feature set: login, feed (All / Following), post, reply threads with a detail page, like, delete own peel, follow/unfollow, profile (bio, counts, edit), search (people + peels), realtime feed refresh, relative timestamps, empty/error states, system+manual dark mode.

## Stack (already set up and verified with `pnpm build`)
- Next **16.3.4** App Router, Turbopack default, React 19, TypeScript strict. `proxy.ts` (Next 16's middleware) refreshes the Supabase session.
- **StyleX 0.19** via `babel.config.js` + `postcss.config.js` + `app/globals.css` (`@stylex;` directive, fonts, reset in `@layer resets`). No Tailwind, no Radix, no next-themes, no clsx, no `next/font`.
- Supabase: `lib/supabase/server.ts` (`createClient()` async, server components/actions), `lib/supabase/client.ts` (browser), `lib/database.types.ts` (Database type; global `Database`, `Profile`, `PeelUnionAuthor` types in `app/global.d.ts`).
- `.env.local` exists with a live project's URL + publishable key. Unauthenticated routes can be smoke-tested with `pnpm dev -p <port>` + curl. You cannot complete GitHub OAuth from an agent; say what you could not verify.
- Previous (deleted) implementation for reference: `git show 2cb24e3:app/peels.tsx`, `git show 2cb24e3:app/likes.tsx`, `git show 2cb24e3:app/new-peel.tsx`, `git show 2cb24e3:app/auth-button-client.tsx`, `git show 2cb24e3:app/page.tsx`. Those patterns (getUser in pages, realtime channel → router.refresh, optimistic like inside startTransition, server action insert) were verified against the live project.

## Design: "Creamsicle"
Full spec (open and read it): `seed/docs/citrinia-creamsicle.html` — sections: color, type, buttons, forms, components, screens, responsive, motion, tokens.

Summary of rules:
- Tokens in `app/tokens.stylex.ts`: `colors` (ground, surface, ink, muted, burnt, amber, mustard, soft, apricot, apricotLip, chip, lip, onButton, onStripe, danger, dangerSoft, dim, shadow, shadowLg, scheme), `fonts` (display = Shrikhand, body = Nunito), `shape` (card 24, sheet 28, field 18, band 20, pill, lip 4, column 520), `gradients` (button, secondary, danger, stripes, handle), `bp` consts (`bp.tablet` = min-width 600, the icon rail; `bp.desktop` = 1024, the aside joins; `bp.wide` = 1280, the rail's labels; `bp.hover` = hover:hover, `bp.reduce` = prefers-reduced-motion). Dark mode is automatic through tokens; explicit themes in `app/themes.ts`.
- **No literal colors** in components; use tokens. (Only exception: the wedge icon's fill.)
- Surfaces are borderless tonal cards: `backgroundColor: colors.surface`, `borderRadius: shape.card`, `boxShadow: colors.shadow`, padding 16. Cards are a 40px avatar column + content grid, gap 12.
- Display text (names, titles, wordmark, sheet titles, empty-state headings): `fontFamily: fonts.display, fontWeight: 400, color: colors.burnt`. Body: Nunito 600; UI labels 800; meta (handle, time) 13px 700 `colors.muted`; tabular digits for counts and times.
- Buttons: use `components/button.tsx` (variants primary/secondary/tertiary/danger/fab/icon, sizes sm/md/lg, `loading`). Links that look like buttons: `{...stylex.props(buttonStyles.base, buttonStyles.variants.primary, buttonStyles.sizes.md)}` on `<Link>`.
- Fields: `components/field.tsx` (`Input`, `Textarea`, `HelpText`; `onSurface` when on a card/sheet; `invalid`).
- Other primitives: `components/avatar.tsx` (`Avatar` src/name/size sm|md|lg/ring), `components/band.tsx` (`Band` full or `slim`, right-slot children; `Wordmark`), `components/pill.tsx` (`Pill` tone mustard|amber|danger, `LivePill`), `components/column.tsx` (`Column` — the one layout unit; `withTabs` reserves bottom space), `components/icons.tsx`.
- Like chip: peach chip (`colors.chip`), apricot on hover, mustard + `WedgeIcon filled` when liked, pop animation once on like (not on unlike), `aria-pressed`.
- Counter pill: "N left" mustard; amber when N < 20; "N over" danger when negative; the post button disables when empty or over. Use `remaining()` from `lib/peel.ts`.
- Menus: native `popover` attribute (React 19 supports `popover`, `popoverTarget`). Sheets/dialogs: native `<dialog>` with `showModal()`.
- Motion: press sink 90ms; like pop 320ms; sheet slide-up 200ms; all disabled under `bp.reduce` (set durations to 0ms under that key).
- Focus: visible 3px amber outline, offset 3. Every interactive target ≥ 44px.

## StyleX rules (eslint enforces some)
- `import * as stylex from "@stylexjs/stylex"`; `const styles = stylex.create({...})` at module scope; apply with `{...stylex.props(styles.a, cond && styles.b, props.style)}`. Accept an optional `style?: stylex.StyleXStyles` prop for composition.
- Pseudo-classes and media queries nest **per property**: `color: { default: colors.ink, ":hover": colors.burnt }`, `paddingInline: { default: 16, [bp.tablet]: 0 }`, nested: `filter: { default: "none", [bp.hover]: { default: "none", ":hover": "brightness(1.07)" } }`. Never a top-level `":hover": {...}` object (lint error). Pseudo-elements (`"::placeholder"`, `"::backdrop"`) are top-level objects.
- No shorthands: use `paddingBlock/paddingInline/paddingTop…`, `marginTop…`, `borderWidth/borderStyle/borderColor`, `backgroundColor/backgroundImage`, `fontFamily/fontSize/fontWeight/lineHeight`, `outlineStyle/outlineWidth/outlineColor/outlineOffset`, `textDecorationLine/Style/Color`.
- Dynamic values: `stylex.create({ w: (px: number) => ({ width: px }) })` then `stylex.props(styles.w(120))`.
- Animations: `animationName: stylex.keyframes({ from: {...}, to: {...} })`.
- Media query keys must be the `bp.*` consts or string literals in the same file.

## Responsive / app-ready (PWA + Capacitor later)
`Column` handles width (viewport under 600px, 520px centered above). Fixed bottom elements: `bottom: "calc(18px + env(safe-area-inset-bottom))"`, `left/right` so the element spans the column width (max 520, centered). Use `100dvh`, never `100vh`. Hover styles only under `bp.hover`. `touchAction: "manipulation"` on buttons (Button does this).

## Verification before you report
Run and paste real output: `pnpm typecheck`, `pnpm lint`, `pnpm build` (Turbopack; takes ~30s), plus your slice's specific checks. A build that passes against stale code is not evidence; rebuild after your last edit. Report: files added/changed, what you verified (with output), what you could not verify and why, anything another slice must do.
