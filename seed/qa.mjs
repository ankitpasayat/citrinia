// Spot-check a content file before accepting it: length rhythm, random peels and
// reply pairs to read, and a scan for replies wired to the neighbouring peel id
// (a recurring generator bug: the reply clearly answers peel N±1 or N±2).
//   node seed/qa.mjs seed/content/bulk-NN.json
// The validator's hard gates still decide; this is for the human read.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node seed/qa.mjs seed/content/<file>.json'); process.exit(2); }
const j = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(j.peels.map(p => [p.id, p]));
const idx = new Map(j.peels.map((p, i) => [p.id, i]));
const pick = (arr, n) => { const a = [...arr], out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; };
const pct = (n, d) => `${(100 * n / d).toFixed(0)}%`;

const lens = j.peels.map(p => [...p.text].length);
const avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
console.log(`${j.cluster}: ${j.personas.length} personas, ${j.peels.length} peels, ${j.replies.length} replies, ${j.reposts.length} reposts; ` +
  `avg ${avg}, <80: ${pct(lens.filter(l => l < 80).length, lens.length)}, <100: ${pct(lens.filter(l => l < 100).length, lens.length)}, ` +
  `180+: ${pct(lens.filter(l => l >= 180).length, lens.length)}, india ${pct(j.peels.filter(p => p.india).length, lens.length)}, ` +
  `quotes ${j.peels.filter(p => p.quote).length}, media ${j.peels.filter(p => p.media).length}`);

console.log('\n== PEELS ==');
for (const p of pick(j.peels, 5)) console.log(`[${p.by}${p.india ? ' 🇮🇳' : ''}${p.quote ? ' quote→' + p.quote : ''}] ${p.text}\n`);
console.log('== REPLY PAIRS ==');
for (const r of pick(j.replies, 3)) { const p = byId.get(r.to); console.log(`PARENT [${p?.by}]: ${p?.text}\nREPLY  [${r.by}]: ${r.text}\n`); }

// Wiring scan: zero content words shared with the parent, three or more with a neighbour.
const stop = new Set('the a an and or of to in on at for is it that this with as by be are was were not but if so you i we they he she my your our their its from have has had do does did than then there here what which who how when where why can could would should just about into over more most some any all one two only also very like same still even'.split(' '));
const words = t => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stop.has(w)));
console.log('== WIRING SCAN (read each; thread closers and same-seed neighbours are often fine) ==');
let flags = 0;
for (const r of j.replies) {
  const i = idx.get(r.to); if (i == null) continue;
  const rw = words(r.text);
  const score = p => { if (!p) return 0; let n = 0; for (const w of words(p.text)) if (rw.has(w)) n++; return n; };
  if (score(byId.get(r.to)) > 0) continue;
  let best = null;
  for (const d of [-2, -1, 1, 2]) { const p = j.peels[i + d]; if (p && score(p) >= 3 && (!best || score(p) > best.s)) best = { p, s: score(p) }; }
  if (best) { flags++; console.log(`${r.id} -> ${r.to}, but ${best.p.id} shares ${best.s} words\n  R: ${r.text.slice(0, 120)}\n  P: ${byId.get(r.to).text.slice(0, 120)}\n  ?: ${best.p.text.slice(0, 120)}`); }
}
console.log(`${flags} flagged of ${j.replies.length}`);
