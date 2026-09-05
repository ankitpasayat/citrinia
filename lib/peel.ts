// A peel is 1 to 280 characters after trimming. Characters are counted as code
// points to match Postgres char_length() in the peels_title_length check.
export const MAX_TITLE = 280;

export function countChars(text: string): number {
  return Array.from(text).length;
}

export function remaining(text: string): number {
  return MAX_TITLE - countChars(text);
}

export function parseTitle(raw: unknown): { title: string } | { error: string } {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (title.length === 0) return { error: "Write something first." };
  const over = countChars(title) - MAX_TITLE;
  if (over > 0) return { error: `That's ${over} over. A peel is 1 to ${MAX_TITLE} characters.` };
  return { title };
}
