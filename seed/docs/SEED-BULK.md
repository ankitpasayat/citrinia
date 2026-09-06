# Bulk writer instructions (one batch per agent)

You are writing one batch of seed content for Citrinia, a Twitter-style feed where posts are **peels**. This is real product content that people will read; the bar is "would a sharp, funny, specific person actually post this". Read these first, fully:
1. `seed/docs/SEED-BRIEF.md` — the content rules and the JSON format (personas, peels, replies, reposts, quotes, mentions, hashtags, media).
2. Your batch file `/home/ankit/Code/citrinia/seed/personas/batch-NN.md` — six personas with voices, opinions and tics, 60 topic seeds and 10 thread seeds. Use these personas **exactly** (handle, name, bio, avatar_style, avatar_seed as written).
3. The anchor files for the bar: read at least 40 peels and 5 full threads from `/home/ankit/Code/citrinia/seed/content/india.json` and `/home/ankit/Code/citrinia/seed/content/society.json`. Match their specificity, length and voice. That is the standard; a previous batch that produced 65-character aphorisms ("Technique absolutely outranks ingredient sourcing.") with replies unrelated to their parents was rejected outright.

## What a peel is (and is not)
A peel is a small piece of writing with a point: an observation with a concrete detail, a short story from the persona's day, a question with a reason for asking, a take with the argument attached, a list, a joke with a setup. It names the dish, the raga, the station, the paper, the album, the line of code, the street. It is **60–280 characters, averaging about 165**: at least a quarter of your peels are 180+ characters, and about 15% are quick takes under 100 characters (a joke, a reaction, a one-line question) so the feed has rhythm and is not all essays. It is **not** a slogan, a fragment, a headline, a fortune cookie, a definition, or a sentence that could open a listicle. Never write "X is Y." as an entire peel. Vary rhythm: some long single sentences, some three short ones, some questions, some one-liners.

## What a reply is
A reply responds to what the parent actually says: quote a phrase of it, answer its question, add the missing fact, disagree with its specific claim, extend its joke. A reader must be able to tell which post it replies to. Replies that could sit under any post are rejected. Use the batch's 10 thread seeds for longer back-and-forth (3–5 replies each, alternating personas, each reply reacting to the previous one). Reaction-only replies ("this 😭" + a reaction GIF from the pool) are fine on a few funny peels.

## Output
Write exactly one file, `/home/ankit/Code/citrinia/seed/content/bulk-NN.draft` (rename to `.json` only when it validates), with `"cluster": "bulk-NN"`, ids `bulk-NN-001`… for peels and `bulk-NN-r001`… for replies. Build it in stages (personas + 100 peels, then more peels, then replies, then reposts), keeping the JSON valid at every stage.

Targets for the batch:
- **400 peels**, about 65 per persona, each persona ranging across their interests and the batch's topic seeds (use every seed at least once, and expand seeds into several distinct peels at different hours and moods). **India share: your batch must land between 28% and 35% of peels flagged `india: true`** (the validator rejects bulk batches outside 22–38%). India-centred personas write about 75% India peels; every other persona at most 8%, staying on their own beat. The flag reflects the subject, not the author; never relabel to pass the gate, rebalance the topics.
- **200 replies** per the rules above; **40 quote peels** (`"quote": "<id>"`) that comment on the specific quoted peel; **100 reposts** (never one's own peel).
- `age_hours` from 0.5 to 500, recent hours denser; replies, quotes and reposts younger than what they point at.
- **Media on about 15% of peels and a few replies, only from the verified pool**: `node seed/pool.mjs --tags <tag1,tag2> [--kind gif|image|youtube] [--limit 8]` (add `--any` to match any tag) and paste the printed objects into `"media": [ … ]` exactly as printed. Pick media that fits the peel; reaction GIFs (`--tags reaction-laugh`, `reaction-agree`, …) go on replies. Never invent or edit a URL; never fetch the web yourself.
- Mentions (`@handle`) only of personas in your batch; at most one hashtag per peel, on about a fifth of peels.
- Follow the politics/religion rules in the brief exactly; nothing hateful, partisan, fabricated, or about private individuals.

## Validate
From the repo root: `node seed/validate.mjs --check-urls seed/content/bulk-NN.draft` until it prints `OK`. The validator enforces the quality gates (average length ≥ 140, at most 15% under 80 chars, at least 25% at 180+, no opening shared by more than two peels, at most 55% of replies with no specific word in common with their parent (hand-written files sit near 35%)) as hard errors. Fix problems by rewriting, never by deleting swathes. Then `mv seed/content/bulk-NN.draft seed/content/bulk-NN.json` and run `node seed/validate.mjs` once more (the whole set must be OK). Paste the validator summary line and three of your favourite peels in your final report. Touch no other file; do not run git; do not start servers.
