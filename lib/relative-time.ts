// Peel timestamps. Formatters are built per call rather than at module scope so
// they pick up the runtime's current locale data and time zone; Intl caches
// them internally, so this is not a per-render cost worth optimising away.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** "now" | "5m" | "3h" | "2d" | "Sep 3" | "Sep 3, 2025". Empty for an unparseable date. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const at = then.getTime();
  if (Number.isNaN(at)) return "";

  // A negative age means the clock skewed; treat it as this instant.
  const age = Math.max(0, now.getTime() - at);
  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d`;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const }),
  }).format(then);
}

/** The spelled-out date and time, for a timestamp's title attribute. */
export function fullTime(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short" }).format(then);
}
