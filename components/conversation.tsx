"use client";

// One conversation: what has been said, and the box to say something back.
//
// Sending goes straight from the browser to send_message(), not through a server
// action -- Next runs actions one at a time per router, and a chat where the
// third message queues behind the first is not a chat. The RPC is safe to call
// from here for the same reason every other direct query is: both insert
// policies still run, so a blocked sender is refused by the database and not by
// this file.
//
// The screen is mounted with `key={conversationId}` by its page, so opening
// another conversation is a new component with its own state rather than this
// one being handed somebody else's messages.
import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { colors, fonts, shape } from "@/app/tokens.stylex";
import { MAX_BODY, parseBody, remainingBody, type Message } from "@/lib/messages";
import { formatRelative, fullTime } from "@/lib/relative-time";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./avatar";
import { Button } from "./button";
import { HelpText, Textarea } from "./field";
import { Pill } from "./pill";
import { MESSAGES_READ_EVENT } from "./message-badge";
import { RichText } from "./rich-text";
import { SendIcon } from "./icons";

/** A message that has not been acknowledged by the server yet, or never will be. */
type Sent = Message & { state?: "sending" | "failed" };

const isPending = (m: Sent) => m.state !== undefined;

export function Conversation({
  viewerId,
  other,
  conversationId,
  messages,
}: {
  viewerId: string;
  other: Profile;
  /** null before the first message: a conversation is made by sending, not by opening. */
  conversationId: string | null;
  messages: Message[];
}) {
  const router = useRouter();
  const channelId = useId();
  const [items, setItems] = useState<Sent[]>(messages);
  const [convId, setConvId] = useState(conversationId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const foot = useRef<HTMLDivElement>(null);
  const nextTemp = useRef(0);

  // The newest message, which is what decides both the scroll and the read mark.
  const newest = items[items.length - 1];
  const newestId = newest?.id;

  // A conversation opens at the bottom, where the new words are, and stays there
  // as they arrive. `instant` on the first paint: sliding down the whole history
  // is a screenful of animation nobody asked to watch.
  const painted = useRef(false);
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end", behavior: painted.current ? "smooth" : "instant" });
    painted.current = true;
  }, [newestId]);

  // Anything the other person has said here has now been seen. Only their
  // messages count: marking a conversation read because you wrote in it would
  // clear a badge that was never raised.
  useEffect(() => {
    if (!convId || !newest || newest.sender_id === viewerId || isPending(newest)) return;
    const supabase = createClient();
    void supabase.rpc("mark_read", { conversation: convId }).then(() => {
      // The badge re-counts rather than clearing: this is one conversation read,
      // not the inbox.
      window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
    });
  }, [convId, newest, newestId, viewerId]);

  // Their side of it, live. A draft conversation has no id yet and nothing to
  // listen to; the subscription starts when the first message makes one.
  useEffect(() => {
    if (!convId) return;
    const supabase = createClient();
    let channel: RealtimeChannel | undefined;
    let cancelled = false;

    // setAuth() first, subscribe second, or the socket joins as `anon` and the
    // messages policy hides every row -- see components/peel-list.tsx.
    supabase.realtime
      .setAuth()
      .then(() => {
        if (cancelled) return;
        channel = supabase
          .channel(`conversation:${channelId}`)
          .on<Message>(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "messages",
              filter: `conversation_id=eq.${convId}`,
            },
            ({ new: row }) =>
              setItems((prev) =>
                // Our own send comes back here as well as through the RPC's
                // answer; whichever arrives second is already in the list.
                prev.some((m) => m.id === row.id) ? prev : [...prev, row],
              ),
          )
          .subscribe();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [convId, channelId]);

  const send = useCallback(
    async (raw: string) => {
      const parsed = parseBody(raw);
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }

      // It is on the screen before it is anywhere else. The id is local and says
      // so, which is also how the realtime echo of the real row is told apart
      // from it.
      const id = `pending-${nextTemp.current++}`;
      const optimistic: Sent = {
        id,
        conversation_id: convId ?? "",
        sender_id: viewerId,
        body: parsed.body,
        created_at: new Date().toISOString(),
        state: "sending",
      };
      setItems((prev) => [...prev, optimistic]);
      setError(null);
      setSending(true);

      const supabase = createClient();
      const { data, error: failed } = await supabase.rpc("send_message", {
        to_user: other.id,
        body: parsed.body,
      });
      setSending(false);

      if (failed || !data) {
        setItems((prev) => prev.map((m) => (m.id === id ? { ...m, state: "failed" } : m)));
        // 42501 is the row-level security refusal, which here means exactly one
        // thing: a block, in one direction or the other.
        setError(
          failed?.code === "42501"
            ? `You can't message @${other.username}.`
            : "That didn't send. Try again.",
        );
        return;
      }

      setItems((prev) => prev.map((m) => (m.id === id ? data : m)));
      if (!convId) {
        // The first message made the conversation. The url says which one is
        // open, so it has to say so now -- and `replace`, because the blank
        // screen behind us is not a place to go back to.
        setConvId(data.conversation_id);
        router.replace(`/messages/${data.conversation_id}`);
      }
    },
    [convId, other.id, other.username, router, viewerId],
  );

  const left = remainingBody(text);
  const over = left < 0;

  return (
    <div {...stylex.props(styles.wrap)}>
      <ol {...stylex.props(styles.list)}>
        {items.length === 0 && (
          <li {...stylex.props(styles.opener)}>
            <Avatar src={other.avatar_url} name={other.name} size="lg" />
            <p {...stylex.props(styles.openerText)}>
              This is the start of your conversation with{" "}
              <Link href={`/u/${encodeURIComponent(other.username)}`} {...stylex.props(styles.openerLink)}>
                {other.name}
              </Link>
              .
            </p>
          </li>
        )}

        {items.map((message) => {
          const mine = message.sender_id === viewerId;
          return (
            <li key={message.id} {...stylex.props(styles.row, mine && styles.rowMine)}>
              <div {...stylex.props(styles.bubble, mine ? styles.mine : styles.theirs)}>
                <RichText text={message.body} style={styles.body} />
              </div>
              <p {...stylex.props(styles.stamp, mine && styles.stampMine)}>
                {message.state === "failed" ? (
                  <>
                    <span {...stylex.props(styles.failed)}>Not sent</span>
                    <button
                      type="button"
                      {...stylex.props(styles.retry)}
                      onClick={() => {
                        setItems((prev) => prev.filter((m) => m.id !== message.id));
                        void send(message.body);
                      }}
                    >
                      Retry
                    </button>
                  </>
                ) : message.state === "sending" ? (
                  "Sending…"
                ) : (
                  <time dateTime={message.created_at} title={fullTime(message.created_at)}>
                    {formatRelative(message.created_at)}
                  </time>
                )}
              </p>
            </li>
          );
        })}
        <div ref={foot} />
      </ol>

      <form
        {...stylex.props(styles.composer)}
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
          setText("");
        }}
      >
        {error && <HelpText error>{error}</HelpText>}
        <div {...stylex.props(styles.box)}>
          <Textarea
            rows={1}
            onSurface
            invalid={over}
            value={text}
            maxLength={MAX_BODY * 2}
            aria-label={`Message @${other.username}`}
            placeholder="Say something"
            style={styles.field}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends where there is a keyboard to press it on. On a phone
              // Enter is the return key and the button is the way to send, or
              // every message would go out at the first line break.
              if (event.key !== "Enter" || event.shiftKey) return;
              if (!window.matchMedia("(pointer: fine)").matches) return;
              event.preventDefault();
              if (text.trim() === "" || over) return;
              void send(text);
              setText("");
            }}
          />
          <Button
            type="submit"
            variant="fab"
            aria-label="Send"
            loading={sending}
            disabled={text.trim() === "" || over}
            style={styles.send}
          >
            <SendIcon style={styles.sendIcon} />
          </Button>
        </div>
        {/* The counter earns its place only when it is nearly relevant. */}
        {left < 200 && (
          <p {...stylex.props(styles.counter)}>
            <Pill tone={over ? "danger" : left < 20 ? "amber" : "mustard"}>
              {over ? `${-left} over` : `${left} left`}
            </Pill>
          </p>
        )}
      </form>
    </div>
  );
}

const styles = stylex.create({
  wrap: { display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", gap: 12, minHeight: 0 },
  list: {
    display: "grid",
    gap: 10,
    alignContent: "start",
    margin: 0,
    padding: 0,
    listStyleType: "none",
    minHeight: 0,
  },
  opener: { display: "grid", justifyItems: "center", gap: 10, paddingBlock: 24, textAlign: "center" },
  openerText: {
    margin: 0,
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: "0.9375rem",
    color: colors.muted,
  },
  openerLink: { color: colors.burnt, fontWeight: 800, textDecorationLine: "none" },
  row: { display: "grid", justifyItems: "start", gap: 2, maxWidth: "min(80%, 460px)" },
  rowMine: { justifySelf: "end", justifyItems: "end" },
  bubble: {
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: 20,
    boxShadow: colors.shadow,
  },
  theirs: { backgroundColor: colors.surface, borderStartStartRadius: 6 },
  mine: { backgroundColor: colors.apricot, borderStartEndRadius: 6 },
  body: { fontSize: "0.9375rem" },
  stamp: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    paddingInline: 6,
    fontFamily: fonts.body,
    fontWeight: 700,
    fontSize: "0.6875rem",
    color: colors.muted,
  },
  stampMine: { justifyContent: "flex-end" },
  failed: { color: colors.danger, fontWeight: 800 },
  retry: {
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    fontFamily: fonts.body,
    fontWeight: 800,
    fontSize: "0.6875rem",
    color: colors.burnt,
    textDecorationLine: "underline",
    cursor: "pointer",
  },
  composer: { position: "sticky", bottom: 0, display: "grid", gap: 8 },
  box: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "end", gap: 10 },
  field: { minHeight: 52, maxHeight: 160, resize: "vertical" },
  send: { alignSelf: "end" },
  sendIcon: { width: 24, height: 24 },
  counter: { margin: 0, justifySelf: "end" },
});
