"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { objectPath, parseMedia } from "@/lib/media";
import { parseTitle } from "@/lib/peel";
import { parseHandle, parseProfile } from "@/lib/profile";

export type ActionResult = {
  error?: string;
  /** Set when a save changed the handle, so the browser can follow the profile. */
  username?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request's client plus the signed-in user. Sends them to /login if there isn't one. */
async function viewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/** Insert a peel for the signed-in user. Shaped for useActionState; call as addPeel({}, formData) otherwise. */
export async function addPeel(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = parseTitle(formData.get("title"));
  if ("error" in parsed) return { error: parsed.error };

  // A reply carries the peel it hangs off; a quote carries the peel it embeds.
  const rawParent = formData.get("parent_id");
  const parentId = typeof rawParent === "string" && rawParent !== "" ? rawParent : null;
  if (parentId !== null && !UUID.test(parentId)) return { error: "Couldn't post that reply. Try again." };

  const rawQuote = formData.get("quote_id");
  const quoteId = typeof rawQuote === "string" && rawQuote !== "" ? rawQuote : null;
  if (quoteId !== null && !UUID.test(quoteId)) return { error: "Couldn't quote that peel. Try again." };

  const media = parseMedia(formData.get("media"));
  if (!Array.isArray(media)) return { error: media.error };

  const { supabase, user } = await viewer();

  const { data: peel, error } = await supabase
    .from("peels")
    .insert({ title: parsed.title, user_id: user.id, parent_id: parentId, quote_id: quoteId })
    .select("id")
    .single();
  if (error || !peel) return { error: "Couldn't post that peel. Try again." };

  if (media.length > 0) {
    const { error: mediaError } = await supabase
      .from("peel_media")
      .insert(media.map((item, position) => ({ peel_id: peel.id, position, ...item })));
    // A peel without the pictures they attached is not the peel they wrote, so
    // compost it and let them try again rather than post half of it.
    if (mediaError) {
      await supabase.from("peels").delete().eq("id", peel.id);
      return { error: "Couldn't attach that media. Try again." };
    }
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

/** Save the signed-in user's name and bio. username and avatar_url stay GitHub-owned. */
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

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
