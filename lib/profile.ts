import { countChars } from "./peel.ts";

// A profile name is 1 to 50 characters and a bio is up to 160, both after
// trimming. Characters are counted as code points to match Postgres
// char_length() in the profiles_bio_length check.
export const MAX_NAME = 50;
export const MAX_BIO = 160;

/** Runs of two or more line breaks (blank lines may hold spaces or tabs). */
const BLANK_LINES = /\n[ \t]*(?:\n[ \t]*)+/g;

export function parseProfile(input: { name: unknown; bio?: unknown }):
  | { name: string; bio: string }
  | { error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0) return { error: "Add a name." };
  const nameOver = countChars(name) - MAX_NAME;
  if (nameOver > 0) {
    return { error: `That name's ${nameOver} over. A name is 1 to ${MAX_NAME} characters.` };
  }

  const bio = (typeof input.bio === "string" ? input.bio : "")
    .replace(/\r\n?/g, "\n")
    .replace(BLANK_LINES, "\n\n")
    .trim();
  const bioOver = countChars(bio) - MAX_BIO;
  if (bioOver > 0) {
    return { error: `That bio's ${bioOver} over. A bio is up to ${MAX_BIO} characters.` };
  }

  return { name, bio };
}
