// Spec: a report carries one reason from a fixed list of three and an optional
// one-line note of up to 280 code points. Both bounds exist in the database too
// (reports_reason and reports_note_length in 20260914000000_settings.sql), so
// these values are the constraint's, not a house style.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_NOTE, REASONS, parseReport } from "./report.ts";

const NO_REASON = "Pick a reason first.";

test("the reasons are exactly the three the database accepts, in sheet order", () => {
  assert.deepEqual(
    REASONS.map((reason) => reason.value),
    ["spam", "abuse", "other"],
  );
  // Every one is offered with something to read, or the sheet is three bare words.
  for (const reason of REASONS) {
    assert.ok(reason.label.length > 0, `${reason.value} has no label`);
    assert.ok(reason.hint.length > 0, `${reason.value} has no hint`);
  }
});

test("MAX_NOTE matches the database constraint", () => {
  assert.equal(MAX_NOTE, 280);
});

test("a reason outside the list is refused, whatever shape it arrives in", () => {
  for (const reason of ["", "Spam", "SPAM", "harassment", " spam", null, undefined, 3, {}, ["spam"]]) {
    assert.deepEqual(parseReport({ reason }), { error: NO_REASON }, `accepted ${JSON.stringify(reason)}`);
  }
});

test("each listed reason is accepted and comes back as itself", () => {
  for (const { value } of REASONS) {
    assert.deepEqual(parseReport({ reason: value }), { reason: value, note: "" });
  }
});

test("the note is optional, and a missing one is an empty string rather than absent", () => {
  assert.deepEqual(parseReport({ reason: "spam" }), { reason: "spam", note: "" });
  assert.deepEqual(parseReport({ reason: "spam", note: undefined }), { reason: "spam", note: "" });
  assert.deepEqual(parseReport({ reason: "spam", note: null }), { reason: "spam", note: "" });
  assert.deepEqual(parseReport({ reason: "spam", note: "   " }), { reason: "spam", note: "" });
  // A note is text; anything else is nothing, not a stringified object.
  assert.deepEqual(parseReport({ reason: "spam", note: { toString: () => "sneaky" } }), { reason: "spam", note: "" });
});

test("a note becomes one line: no leading or trailing space, no runs, no breaks", () => {
  assert.deepEqual(parseReport({ reason: "other", note: "  keeps   posting\n\nthe same link  " }), {
    reason: "other",
    note: "keeps posting the same link",
  });
  assert.deepEqual(parseReport({ reason: "other", note: "tabs\tand\r\nbreaks" }), {
    reason: "other",
    note: "tabs and breaks",
  });
});

test("280 is accepted and 281 is refused, counted the way Postgres counts", () => {
  const at = "x".repeat(MAX_NOTE);
  assert.deepEqual(parseReport({ reason: "other", note: at }), { reason: "other", note: at });

  const over = "x".repeat(MAX_NOTE + 1);
  assert.deepEqual(parseReport({ reason: "other", note: over }), {
    error: "That note's 1 over. 280 characters at most.",
  });
  assert.deepEqual(parseReport({ reason: "other", note: "x".repeat(MAX_NOTE + 9) }), {
    error: "That note's 9 over. 280 characters at most.",
  });

  // An emoji is one code point to char_length(), so 280 of them fit.
  assert.deepEqual(parseReport({ reason: "other", note: "🍊".repeat(MAX_NOTE) }), {
    reason: "other",
    note: "🍊".repeat(MAX_NOTE),
  });
  assert.deepEqual(parseReport({ reason: "other", note: "🍊".repeat(MAX_NOTE + 1) }), {
    error: "That note's 1 over. 280 characters at most.",
  });
});

test("the length is judged after collapsing, so padding never costs the note", () => {
  // 280 characters plus whitespace that is about to be thrown away is not 281.
  const padded = `   ${"x".repeat(MAX_NOTE)}   `;
  assert.deepEqual(parseReport({ reason: "other", note: padded }), {
    reason: "other",
    note: "x".repeat(MAX_NOTE),
  });
});

test("the reason is checked before the note, so a bad reason is the thing you hear about", () => {
  assert.deepEqual(parseReport({ reason: "nope", note: "x".repeat(MAX_NOTE + 1) }), { error: NO_REASON });
});
