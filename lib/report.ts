import { countChars } from "./peel.ts";

// The three reasons the sheet offers, in the order it offers them. `value` is
// what the reports_reason constraint accepts; the labels are what people read.
// Anything outside this list is refused here and refused again by the database.
export const REASONS = [
  { value: "spam", label: "Spam", hint: "Scams, bots, the same link forty times" },
  { value: "abuse", label: "Abuse", hint: "Harassment, threats, hate" },
  { value: "other", label: "Something else", hint: "Tell us in a line" },
] as const;

export type Reason = (typeof REASONS)[number]["value"];

/** A note is one line, up to 280 -- the same bound a peel has, and the same one
 *  reports_note_length applies. Optional on every reason. */
export const MAX_NOTE = 280;

export function parseReport(input: { reason: unknown; note?: unknown }): { reason: Reason; note: string } | { error: string } {
  const reason = REASONS.find((option) => option.value === input.reason)?.value;
  if (reason === undefined) return { error: "Pick a reason first." };

  // One line, however it was pasted: this sits in a queue somebody skims.
  const note = (typeof input.note === "string" ? input.note : "").replace(/\s+/g, " ").trim();
  const over = countChars(note) - MAX_NOTE;
  if (over > 0) return { error: `That note's ${over} over. ${MAX_NOTE} characters at most.` };

  return { reason, note };
}
