"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { firstPreviewLink } from "@/lib/link-preview";
import { recordLinkPreview } from "@/lib/link-preview-fetch";
import { objectPath } from "@/lib/media";
import { UUID } from "@/lib/peel";
import { parseHandle, parseProfile } from "@/lib/profile";
import { parseReport } from "@/lib/report";
import { parseThread } from "@/lib/thread";

export type ActionResult = {
  error?: string;
  /** Set when a save changed the handle, so the browser can follow the profile. */
  username?: string;
};

/** The request's client plus the signed-in user. Sends them to /login if there isn't one. */
async function viewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * Post what the composer wrote: one peel, or a thread of them as a chain. Shaped
 * for useActionState; call as addPeel({}, formData) otherwise.
 *
 * Every box goes up in one add_thread() call, which is one transaction, so a
 * thread posts whole or not at all -- there is no state where three of your five
 * peels are live and the rest are gone. A single peel takes the same route,
 * because a peel and a thread of one are the same act.
 */
export async function addPeel(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const items = parseThread(formData.get("items"));
  if (!Array.isArray(items)) return { error: items.error };

  // A reply carries the peel it hangs off; a quote carries the peel it embeds.
  // Both belong to the first box: the rest are replies to the one before them.
  const rawParent = formData.get("parent_id");
  const parentId = typeof rawParent === "string" && rawParent !== "" ? rawParent : null;
  if (parentId !== null && !UUID.test(parentId)) return { error: "Couldn't post that reply. Try again." };

  const rawQuote = formData.get("quote_id");
  const quoteId = typeof rawQuote === "string" && rawQuote !== "" ? rawQuote : null;
  if (quoteId !== null && !UUID.test(quoteId)) return { error: "Couldn't quote that peel. Try again." };

  const { supabase } = await viewer();

  // A link in the text gets a card. The fetches run beside the insert rather
  // than after it -- they are independent, since a preview is keyed by the url
  // and not by the peel that mentioned it -- so posting costs the slowest of
  // them and never the sum. Each has a three-second ceiling and swallows
  // everything: a slow or hostile page means no card, never a failed post.
  //
  // Nothing is fetched for a box that carries media, or for the first one when
  // it quotes, because the card would have nowhere to go; attachPreviews skips
  // exactly the same ones. A url written twice in one thread is fetched once.
  const links = [
    ...new Set(
      items
        .filter((item, at) => item.media.length === 0 && !(at === 0 && quoteId !== null))
        .map((item) => firstPreviewLink(item.title))
        .filter((link) => link !== null),
    ),
  ];

  const [{ error }] = await Promise.all([
    supabase.rpc("add_thread", { items, parent: parentId, quote: quoteId }),
    Promise.all(links.map((link) => recordLinkPreview(supabase, link))),
  ]);
  if (error) {
    return { error: items.length > 1 ? "Couldn't post that thread. Try again." : "Couldn't post that peel. Try again." };
  }

  revalidatePath("/");
  if (parentId) revalidatePath(`/p/${parentId}`);
  if (quoteId) revalidatePath(`/p/${quoteId}`);
  return {};
}

/** Delete one of the signed-in user's own peels, and its uploads. RLS rejects anyone else's. */
export async function deletePeel(id: string): Promise<ActionResult> {
  const { supabase } = await viewer();

  // The peel's media rows go with it by cascade, so the urls are read first.
  const { data: media } = await supabase.from("peel_media").select("url").eq("peel_id", id);
  const { error, count } = await supabase.from("peels").delete({ count: "exact" }).eq("id", id);
  if (error || count === 0) return { error: "Couldn't delete that peel." };

  // Only objects in this project's bucket are ours to remove, and the bucket
  // policy lets the signed-in user delete from their own folder alone. Best
  // effort: the peel is already gone, and the nightly sweep
  // (scripts/sweep-media.mjs) catches anything left behind.
  const paths = (media ?? [])
    .map((row) => objectPath(row.url, process.env.NEXT_PUBLIC_SUPABASE_URL!, "media"))
    .filter((path) => path !== null);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from("media").remove(paths);
    if (storageError) console.error(`Couldn't remove the media of peel ${id}: ${storageError.message}`);
  }
  revalidatePath("/", "layout");
  return {};
}

/** Repeel: put somebody's peel back on your followers' timeline under your name. */
export async function repost(peelId: string): Promise<ActionResult> {
  if (!UUID.test(peelId)) return { error: "Couldn't repeel that. Try again." };
  const { supabase, user } = await viewer();

  const { error } = await supabase.from("reposts").insert({ user_id: user.id, peel_id: peelId });
  if (error) return { error: "Couldn't repeel that. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/** Take a repeel back. A no-op if the signed-in user had not reposted it. */
export async function unrepost(peelId: string): Promise<ActionResult> {
  if (!UUID.test(peelId)) return { error: "Couldn't undo that repeel. Try again." };
  const { supabase, user } = await viewer();

  const { error } = await supabase
    .from("reposts")
    .delete()
    .eq("user_id", user.id)
    .eq("peel_id", peelId);
  if (error) return { error: "Couldn't undo that repeel. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/** Save a peel to the signed-in user's own list. Nobody else can see it. */
export async function bookmark(peelId: string): Promise<ActionResult> {
  if (!UUID.test(peelId)) return { error: "Couldn't save that peel. Try again." };
  const { supabase, user } = await viewer();

  const { error } = await supabase.from("bookmarks").insert({ user_id: user.id, peel_id: peelId });
  if (error) return { error: "Couldn't save that peel. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/** Drop a peel from the signed-in user's saved list. */
export async function unbookmark(peelId: string): Promise<ActionResult> {
  if (!UUID.test(peelId)) return { error: "Couldn't unsave that peel. Try again." };
  const { supabase, user } = await viewer();

  const { error } = await supabase
    .from("bookmarks")
    .delete()
    .eq("user_id", user.id)
    .eq("peel_id", peelId);
  if (error) return { error: "Couldn't unsave that peel. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/** Mark every unopened notification read. read_at is the only column a user may write. */
export async function markNotificationsRead(): Promise<ActionResult> {
  const { supabase, user } = await viewer();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) return { error: "Couldn't mark those read." };
  revalidatePath("/", "layout");
  return {};
}

/** Follow another profile. RLS rejects following on someone else's behalf. */
export async function followUser(followeeId: string): Promise<ActionResult> {
  if (!UUID.test(followeeId)) return { error: "Couldn't follow. Try again." };

  const { supabase, user } = await viewer();
  if (user.id === followeeId) return { error: "You can't follow yourself." };

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: user.id, followee_id: followeeId });
  if (error) return { error: "Couldn't follow. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/** Unfollow a profile. A no-op if the signed-in user was not following it. */
export async function unfollowUser(followeeId: string): Promise<ActionResult> {
  if (!UUID.test(followeeId)) return { error: "Couldn't unfollow. Try again." };

  const { supabase, user } = await viewer();

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("followee_id", followeeId);
  if (error) return { error: "Couldn't unfollow. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Accept a message request: it leaves the Requests tab, joins the inbox and
 * starts counting on the badge. Replying to it does the same thing without this
 * -- see the bump_conversation() trigger -- so this is the button for somebody
 * who wants to keep a conversation without answering yet.
 *
 * accept_conversation() is definer and does its own checking: only the person it
 * was sent to, only while it is still pending. Calling it on anything else
 * changes nothing rather than failing, which is the right answer to accepting
 * twice.
 */
export async function acceptRequest(conversationId: string): Promise<ActionResult> {
  if (!UUID.test(conversationId)) return { error: "Couldn't accept that. Try again." };

  const { supabase } = await viewer();
  const { error } = await supabase.rpc("accept_conversation", { conversation: conversationId });
  if (error) return { error: "Couldn't accept that. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Bin a request, and the messages in it. The policy allows this only for a
 * pending conversation somebody else started: a request you sent is not yours to
 * take back out of their inbox, and an accepted conversation is not yours to
 * erase for both of you.
 *
 * RLS refuses by matching no rows rather than by raising, so the returned rows
 * are what says it worked -- without `select()` a refusal and a success are the
 * same silent answer.
 */
export async function deleteRequest(conversationId: string): Promise<ActionResult> {
  if (!UUID.test(conversationId)) return { error: "Couldn't delete that. Try again." };

  const { supabase } = await viewer();
  const { data, error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .select("id");
  if (error || !data || data.length === 0) return { error: "Couldn't delete that. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Mute a profile: their peels leave the viewer's feeds, replies and search, and
 * they stop ringing the viewer's bell. Nothing is said to them, and the follow
 * between the two, either way, is left exactly as it was.
 *
 * Muting somebody already muted is a primary-key collision, which is the right
 * answer to "mute them" -- so 23505 comes back as success, the way a duplicate
 * report does in reportContent.
 */
export async function muteUser(profileId: string): Promise<ActionResult> {
  if (!UUID.test(profileId)) return { error: "Couldn't mute. Try again." };

  const { supabase, user } = await viewer();
  if (user.id === profileId) return { error: "You can't mute yourself." };

  const { error } = await supabase
    .from("mutes")
    .insert({ muter_id: user.id, muted_id: profileId });
  if (error && error.code !== "23505") return { error: "Couldn't mute. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/** Unmute a profile. A no-op if the signed-in user had not muted them. */
export async function unmuteUser(profileId: string): Promise<ActionResult> {
  if (!UUID.test(profileId)) return { error: "Couldn't unmute. Try again." };

  const { supabase, user } = await viewer();

  const { error } = await supabase
    .from("mutes")
    .delete()
    .eq("muter_id", user.id)
    .eq("muted_id", profileId);
  if (error) return { error: "Couldn't unmute. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Block a profile. The database does the work: the SELECT policy on peels hides
 * both people from each other, a trigger severs the follows both ways, and the
 * insert policies stop anything attaching across it. There is nothing to do here
 * beyond writing the row and saying so.
 *
 * Blocking somebody already blocked collides on the primary key, which is the
 * right answer to "block them" -- so 23505 is success, as it is for mute.
 */
export async function blockUser(profileId: string): Promise<ActionResult> {
  if (!UUID.test(profileId)) return { error: "Couldn't block. Try again." };

  const { supabase, user } = await viewer();
  if (user.id === profileId) return { error: "You can't block yourself." };

  const { error } = await supabase
    .from("blocks")
    .insert({ blocker_id: user.id, blocked_id: profileId });
  if (error && error.code !== "23505") return { error: "Couldn't block. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Unblock a profile. The peels come back on their own -- they were never gone,
 * only out of reach -- and the follows deliberately do not: quietly re-following
 * somebody you had blocked is a worse surprise than pressing the button again.
 */
export async function unblockUser(profileId: string): Promise<ActionResult> {
  if (!UUID.test(profileId)) return { error: "Couldn't unblock. Try again." };

  const { supabase, user } = await viewer();

  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", profileId);
  if (error) return { error: "Couldn't unblock. Try again." };
  revalidatePath("/", "layout");
  return {};
}

/** Save the signed-in user's profile: the words, the facts, the pictures, and
 *  the handle -- which goes through change_username() rather than the update. */
export async function updateProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = parseProfile({
    name: formData.get("name"),
    bio: formData.get("bio"),
    location: formData.get("location"),
    website: formData.get("website"),
  });
  if ("error" in parsed) return { error: parsed.error };

  const { supabase, user } = await viewer();

  // A picture the sheet did not touch is absent from the form, which is not the
  // same as an empty one: absent leaves the column alone, empty takes the
  // picture down. Their contents are the database's to judge -- profiles_avatar_url_ok
  // and profiles_banner_url_ok are what keep a `javascript:` url out of an href.
  const patch: Database["public"]["Tables"]["profiles"]["Update"] = {
    name: parsed.name,
    bio: parsed.bio,
    location: parsed.location,
    website: parsed.website,
  };
  const avatar = formData.get("avatar_url");
  if (typeof avatar === "string") patch.avatar_url = avatar;
  const banner = formData.get("banner_url");
  if (typeof banner === "string") patch.banner_url = banner;

  // The handle goes first and on its own: it is the one field the owner cannot
  // write directly (username is granted to nobody), because taking one has to
  // check who holds it, who held it recently, and leave the old one forwarding.
  // Doing it first also means a refused handle saves nothing else, which is
  // what somebody who typed a taken handle expects.
  const rawHandle = formData.get("username");
  let renamed: string | undefined;
  if (typeof rawHandle === "string") {
    const wanted = parseHandle(rawHandle);
    if ("error" in wanted) return { error: wanted.error };

    const { data: current } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();

    if (current && current.username !== wanted.handle) {
      const { data, error: renameError } = await supabase.rpc("change_username", {
        new_username: wanted.handle,
      });
      // The database's own words: "that handle is taken", "on hold until ...".
      if (renameError) return { error: message(renameError.message) };
      renamed = data ?? wanted.handle;
    }
  }

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) return { error: "Couldn't save your profile. Try again." };
  revalidatePath("/", "layout");
  return renamed ? { username: renamed } : {};
}

/**
 * A Postgres error message as something to read. change_username() raises the
 * sentence it wants shown; anything else is a fault, not an explanation.
 */
function message(raw: string): string {
  const said = raw.trim();
  return /^(that handle|a handle|sign in)/.test(said)
    ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.`
    : "Couldn't change your handle. Try again.";
}

/**
 * Lead your profile with one peel, or stop. Idempotent, and the database is what
 * enforces that the peel is yours -- pinned_peel_must_be_yours() -- so a crafted
 * call gets an error rather than a stranger's peel over your name.
 */
export async function setPinnedPeel(peelId: string | null): Promise<ActionResult> {
  if (peelId !== null && !UUID.test(peelId)) return { error: "Couldn't pin that peel." };

  const { supabase, user } = await viewer();
  const { error } = await supabase
    .from("profiles")
    .update({ pinned_peel_id: peelId })
    .eq("id", user.id);
  if (error) return { error: "Couldn't pin that peel. Try again." };

  revalidatePath("/", "layout");
  return {};
}

/**
 * File a report about one peel or one profile. Shaped for useActionState.
 *
 * There is no moderation screen: the reports table is the queue, read with the
 * service role. So the reporter hears the same sentence either way, and the one
 * thing that has to be right is whose name ends up on the row -- which the RLS
 * policy, not this function, is what settles.
 */
export async function reportContent(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = parseReport({ reason: formData.get("reason"), note: formData.get("note") });
  if ("error" in parsed) return { error: parsed.error };

  const rawPeel = formData.get("peel_id");
  const peelId = typeof rawPeel === "string" && rawPeel !== "" ? rawPeel : null;
  const rawProfile = formData.get("profile_id");
  const profileId = typeof rawProfile === "string" && rawProfile !== "" ? rawProfile : null;

  // One subject, the same rule reports_one_subject applies. Neither means the
  // form lost it; both means somebody built the request by hand.
  if ((peelId === null) === (profileId === null)) return { error: "Couldn't send that report." };
  if (peelId !== null && !UUID.test(peelId)) return { error: "Couldn't send that report." };
  if (profileId !== null && !UUID.test(profileId)) return { error: "Couldn't send that report." };

  const { supabase, user } = await viewer();
  // Free to check, because the id is already here. The same is not done for a
  // peel -- that would cost a round trip to learn who wrote it, and a report of
  // your own peel is noise in a queue rather than a way in.
  if (profileId === user.id) return { error: "You can't report yourself." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    peel_id: peelId,
    profile_id: profileId,
    reason: parsed.reason,
    note: parsed.note,
  });
  // 23505 is reports_one_per_peel / reports_one_per_profile: they already told
  // us about this one. Saying it twice is not a failure, and telling them it was
  // would only invite a third.
  if (error && error.code !== "23505") return { error: "Couldn't send that report. Try again." };
  return {};
}

/**
 * Close the account the caller is signed in to, for good.
 *
 * The typed handle is the confirmation and delete_account() is what checks it --
 * against the session's own profile, in the database, where a crafted call
 * cannot get past it either. Everything the person has hangs off their
 * auth.users row on delete cascade, so there is nothing to tidy up here.
 */
export async function deleteAccount(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const raw = formData.get("confirm");
  const { supabase } = await viewer();

  const { error } = await supabase.rpc("delete_account", {
    confirm: typeof raw === "string" ? raw : "",
  });
  if (error) {
    // The one failure a person can cause is typing the wrong handle; the
    // database says so in those words. Anything else is a fault.
    return /handle/.test(error.message)
      ? { error: "That's not your handle." }
      : { error: "Couldn't delete your account. Try again." };
  }

  // Local scope: the session rows cascaded away with the user a moment ago, so
  // there is nothing left to revoke -- this is only here to drop the cookies.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
