#!/usr/bin/env node
// Query the verified media pool so writers never fetch the web themselves.
// Usage: node seed/pool.mjs --tags india,food [--kind image|gif|youtube] [--limit 12] [--any]
// Matches items carrying ALL the given tags (or ANY with --any); prints JSON lines ready to paste into a `media` array.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const tags = (opt("tags", "") || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
const kind = opt("kind", null);
const limit = Number(opt("limit", "12"));
const any = argv.includes("--any");

const pool = JSON.parse(readFileSync(join(HERE, "media-pool.json"), "utf8"));
const items = (pool.items ?? []).filter((m) => {
  if (kind && m.kind !== kind) return false;
  if (tags.length === 0) return true;
  const have = new Set((m.tags ?? []).map((t) => String(t).toLowerCase()));
  return any ? tags.some((t) => have.has(t)) : tags.every((t) => have.has(t));
});

if (items.length === 0) {
  console.error(`no pool items match tags=[${tags.join(",")}] kind=${kind ?? "any"}; try --any or fewer tags`);
  process.exit(1);
}
for (const m of items.slice(0, limit)) {
  const out = { kind: m.kind, url: m.url };
  if (m.kind !== "youtube") out.alt = m.alt;
  console.log(JSON.stringify(out) + "   // tags: " + (m.tags ?? []).join(", ") + (m.kind === "youtube" && m.alt ? " · " + m.alt : ""));
}
console.error(`${items.length} match(es), showing ${Math.min(limit, items.length)}`);
