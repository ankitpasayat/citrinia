"use client";

// A compose box that knows about people. Type `@` and two characters and up to
// five of them appear under the box; arrows move, Enter or Tab picks, Escape
// puts the list away. Everything else about it is an ordinary textarea.
//
// Under the box rather than at the caret's line, deliberately: measuring a caret
// inside a textarea means a hidden mirror element that has to be kept in step
// with the real one's padding, font and wrapping, and it drifts the moment any
// of those change. The box is at the top of the sheet, so a list hanging off its
// bottom edge is well clear of a phone keyboard -- which is what the caret rule
// was for in the first place.
//
// The lookup goes straight from the browser to PostgREST rather than through a
// server action, because Next runs actions one at a time per router and a
// typeahead that queues behind the last keystroke is not a typeahead. Reading
// profiles needs nothing the browser does not already have.
//
// It stays a plain textbox to a screen reader -- `aria-autocomplete`,
// `aria-controls` and `aria-activedescendant`, with no `role="combobox"`. The
// role would change what the box IS, and it is a compose box first: somebody
// writing a peel is not filling in a form field with a fixed set of answers.
import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef, useState } from "react";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { completeMention, isHandleTerm, mentionAt } from "@/lib/mentions";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./avatar";
import { Textarea } from "./field";

/** As much of a profile as a row in the list shows. */
type Candidate = Pick<Profile, "id" | "username" | "name" | "avatar_url">;

/** What the handle being typed is, and where it starts. */
type Term = { term: string; start: number };

const SHOWN = 5;
/** Long enough that a fast typist makes one request rather than six. */
const SETTLE_MS = 150;
/** Keys the open list has already dealt with on the way down. */
const HANDLED = new Set(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown"]);

type Props = Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onChange: (text: string) => void;
};

export function MentionBox({ value, onChange, ...rest }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  // The list and the term it answers, together: a list found for "@bo" must not
  // be shown for a moment against "@ad" while the next lookup is in the air.
  const [found, setFound] = useState<{ term: string; people: Candidate[] }>({ term: "", people: [] });
  const [active, setActive] = useState(0);
  const [term, setTerm] = useState<Term | null>(null);
  // Escape closes the list for the handle being typed, not for ever: the next
  // one they start asks again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Where the caret goes once a picked handle has been rendered. React owns the
  // value, so the caret cannot be moved until the new text is actually in the box.
  const caretAfterPick = useRef<number | null>(null);

  const people = found.people;
  const open = term !== null && dismissed !== term.term && found.term === term.term && people.length > 0;

  /**
   * Read the box itself -- not the `value` prop, which is a render behind during
   * a keystroke -- and work out whether a handle is being typed at the caret.
   * The term keeps its identity when it has not really changed, so a caret that
   * moved within the same handle does not restart the lookup.
   */
  function look() {
    const el = box.current;
    if (!el) return;
    const here = mentionAt(el.value, el.selectionStart);
    const next = here !== null && isHandleTerm(here.term) ? here : null;
    setTerm((current) => {
      if (current === null || next === null) return next;
      return current.term === next.term && current.start === next.start ? current : next;
    });
  }

  // One request per settled term, and the answer to a stale one is dropped: a
  // slow reply to "@bo" must not land on top of the list for "@bob".
  useEffect(() => {
    if (term === null || dismissed === term.term) return;
    let current = true;
    const timer = setTimeout(async () => {
      const supabase = createClient();
      // The term is `[A-Za-z0-9_]` by construction (isHandleTerm), which holds
      // no metacharacter, so it is a pattern that can only match itself.
      const quoted = `"${term.term}"`;
      const { data } = await supabase
        .from("profiles")
        .select("id, username, name, avatar_url")
        .or(`username.imatch.${quoted},name.imatch.${quoted}`)
        .limit(SHOWN);
      if (!current) return;
      setFound({ term: term.term, people: data ?? [] });
      setActive(0);
    }, SETTLE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term, dismissed]);

  // The picked text arrives as a new `value` from above; the caret follows it in.
  useEffect(() => {
    const caret = caretAfterPick.current;
    if (caret === null) return;
    caretAfterPick.current = null;
    box.current?.focus();
    box.current?.setSelectionRange(caret, caret);
  }, [value]);

  function pick(person: Candidate) {
    const el = box.current;
    if (term === null || !el) return;
    const done = completeMention(el.value, term.start, el.selectionStart, person.username);
    caretAfterPick.current = done.caret;
    onChange(done.text);
    setTerm(null);
  }

  return (
    <div {...stylex.props(styles.wrap)}>
      <Textarea
        ref={box}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        {...rest}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setDismissed(null);
          look();
        }}
        // A click or an arrow key moves the caret into or out of a handle, so
        // the list is worked out again rather than left where it was. The keys
        // the open list consumed are skipped: their keyup would undo the pick
        // that their keydown just made.
        onClick={look}
        onSelect={look}
        onKeyUp={(event) => {
          if (!HANDLED.has(event.key)) look();
        }}
        onBlur={() => setTerm(null)}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((at) => (at + 1) % people.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((at) => (at - 1 + people.length) % people.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            // Only while the list is open: Enter is a new line the rest of the time.
            event.preventDefault();
            pick(people[active]);
          } else if (event.key === "Escape") {
            // Stopped here: Escape closes the sheet, and putting a list away is
            // not a reason to throw away what somebody has written.
            event.preventDefault();
            event.stopPropagation();
            setDismissed(term.term);
          }
        }}
      />

      {open && (
        <ul id={listId} role="listbox" aria-label="People to mention" {...stylex.props(styles.list)}>
          {people.map((person, at) => (
            <li
              key={person.id}
              id={`${listId}-${at}`}
              role="option"
              aria-selected={at === active}
              // mousedown rather than click: the default would blur the box
              // first, which closes the list out from under the pointer.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              onMouseEnter={() => setActive(at)}
              {...stylex.props(styles.row, at === active && styles.activeRow)}
            >
              <Avatar src={person.avatar_url} name={person.name} size="sm" />
              <span {...stylex.props(styles.who)}>
                <b {...stylex.props(styles.name)}>{person.name}</b>
                <span {...stylex.props(styles.handle)}>@{person.username}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles = stylex.create({
  wrap: { position: "relative" },
  list: {
    position: "absolute",
    zIndex: 2,
    top: "calc(100% + 6px)",
    right: 0,
    left: 0,
    margin: 0,
    paddingBlock: 6,
    paddingInline: 0,
    listStyleType: "none",
    backgroundColor: colors.surface,
    borderRadius: shape.field,
    boxShadow: colors.shadowLg,
    overflow: "hidden",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBlock: 8,
    paddingInline: 12,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": colors.chip },
  },
  activeRow: { backgroundColor: colors.chip },
  who: { display: "grid", minWidth: 0 },
  name: {
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.9375rem",
    color: colors.ink,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  handle: {
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: "0.8125rem",
    color: colors.muted,
  },
});
