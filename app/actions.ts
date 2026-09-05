"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseTitle } from "@/lib/peel";
import { parseProfile } from "@/lib/profile";

export type ActionResult = { error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Insert a peel for the signed-in user. Shaped for useActionState; call as addPeel({}, formData) otherwise. */
export async function addPeel(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = parseTitle(formData.get("title"));
  if ("error" in parsed) return { error: parsed.error };

  // A reply carries the peel it hangs off; a top-level peel carries nothing.
  const rawParent = formData.get("parent_id");
  const parentId = typeof rawParent === "string" && rawParent !== "" ? rawParent : null;
  if (parentId !== null && !UUID.test(parentId)) return { error: "Couldn't post that reply. Try again." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("peels")
    .insert({ title: parsed.title, user_id: user.id, parent_id: parentId });
  if (error) return { error: "Couldn't post that peel. Try again." };
  revalidatePath("/");
  if (parentId) revalidatePath(`/p/${parentId}`);
  return {};
}

/** Delete one of the signed-in user's own peels. RLS rejects anyone else's. */
export async function deletePeel(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error, count } = await supabase.from("peels").delete({ count: "exact" }).eq("id", id);
  if (error || count === 0) return { error: "Couldn't delete that peel." };
  revalidatePath("/", "layout");
  return {};
}

/** Follow another profile. RLS rejects following on someone else's behalf. */
export async function followUser(followeeId: string): Promise<ActionResult> {
  if (!UUID.test(followeeId)) return { error: "Couldn't follow. Try again." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
  const parsed = parseProfile({ name: formData.get("name"), bio: formData.get("bio") });
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ name: parsed.name, bio: parsed.bio })
    .eq("id", user.id);
  if (error) return { error: "Couldn't save your profile. Try again." };
  revalidatePath("/", "layout");
  return {};
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
