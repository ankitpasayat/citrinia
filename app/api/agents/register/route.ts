import { createClient } from "@supabase/supabase-js";
import { agentEmail, clientIp, fail, newSecret, readJson } from "@/lib/agents";
import { parseHandle, parseProfile } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Five new agents an hour from one address. Long enough to try, short enough to be dull. */
const SIGNUPS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
/** The hold change_username() puts on a handle somebody has let go of. */
const HOLD_MS = 30 * 24 * HOUR_MS;

/**
 * Where an agent gets its key. The only route here that holds the service role,
 * and the only one that has to: creating an account is not something an account
 * can do, and the signup ledger is nobody's to read.
 *
 * The key is handed over once and never stored -- the secret in it IS the
 * password, so what we keep is GoTrue's bcrypt of it and nothing else. Losing it
 * means registering again under another handle, which is the same deal a person
 * gets from a password manager and the reason the response says so out loud.
 */
export async function POST(request: Request) {
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRole) {
    console.error("Agent registration is off: SUPABASE_SERVICE_ROLE_KEY is not set.");
    return fail("Registration is not configured on this deployment.", 503);
  }

  const body = await readJson(request);
  const handle = parseHandle(body.handle);
  if ("error" in handle) return fail(handle.error, 400);
  // An agent has no location and no website to put on a profile; the parser
  // wants all four, and the two it does not use are empty rather than absent.
  const profile = parseProfile({ name: body.name, bio: body.bio, location: "", website: "" });
  if ("error" in profile) return fail(profile.error, 400);

  const avatar = typeof body.avatar_url === "string" ? body.avatar_url.trim() : "";
  // Said here rather than left to the trigger: `storable_picture_url` drops a
  // url it cannot store and carries on, so an agent with a plain-http avatar
  // would otherwise get a 201 and a blank face with nothing said about it.
  if (avatar !== "" && !avatar.startsWith("https://")) {
    return fail("An avatar_url has to start with https://.", 400);
  }

  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ip = clientIp(request.headers);
  const { count, error: countError } = await admin
    .from("agent_signups")
    .select("ip", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("at", new Date(Date.now() - HOUR_MS).toISOString());
  // A ledger that will not answer is a limit that is not being applied, so this
  // fails shut. It is the same sentence as a missing key because it is the same
  // fact from the caller's side: this deployment cannot register anybody.
  if (countError) {
    console.error(`Couldn't count agent signups: ${countError.message}`);
    return fail("Registration is not configured on this deployment.", 503);
  }
  if ((count ?? 0) >= SIGNUPS_PER_HOUR) {
    return fail("Five new agents an hour from one address is the limit. Try again later.", 429);
  }

  // Free means free both ways: nobody holds it now, and nobody let it go inside
  // the last thirty days. That second half is change_username()'s rule, and a
  // new account has to obey it or registering would be the way around a rename.
  const [{ data: taken }, { data: held }] = await Promise.all([
    admin.from("profiles").select("id").eq("username", handle.handle).maybeSingle(),
    admin
      .from("username_history")
      .select("username")
      .eq("username", handle.handle)
      .gte("released_at", new Date(Date.now() - HOLD_MS).toISOString())
      .maybeSingle(),
  ]);
  if (taken || held) return fail(`@${handle.handle} is taken.`, 409);

  const secret = newSecret();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: agentEmail(handle.handle),
    password: secret,
    // There is no inbox to send a link to, and no human to click it.
    email_confirm: true,
    // Exactly the three keys insert_profile_for_new_user() reads.
    user_metadata: { name: profile.name, user_name: handle.handle, avatar_url: avatar },
    // app_metadata, not user_metadata: only the service role may write it, so
    // "this is an agent" is a fact the account cannot later edit about itself.
    app_metadata: { kind: "agent" },
  });
  if (createError || !created.user) {
    // ponytail: the unique index on the handle is checked by the trigger inside
    // GoTrue's own transaction, and GoTrue reports anything that fails there as
    // one 500 with this sentence -- there is no code to match on. Two agents
    // racing for the same handle is the only way to reach it that we know of, so
    // it is read as the 409 the check above would have given had it lost by less.
    if (/database error creating new user/i.test(createError?.message ?? "")) {
      return fail(`@${handle.handle} is taken.`, 409);
    }
    console.error(`Couldn't register an agent: ${createError?.message ?? "no user came back"}`);
    return fail("Couldn't register that agent.", 500);
  }

  // The account exists from here on, so nothing below may fail the request: the
  // key is in this response and nowhere else, and losing it to a bio that would
  // not save would cost the agent its whole account.
  //
  // `kind` is not written here, deliberately. The signup trigger reads it from
  // app_metadata, and GoTrue's admin create writes app_metadata in a second
  // statement after the insert -- so sync_profile_kind() in
  // 20260922000000_agents.sql catches that update and badges the profile. Saying
  // it from here as well would put "this account is an agent" in two places, and
  // one of them would eventually be the one that got fixed.
  if (profile.bio !== "") {
    // The signup trigger writes name, handle and avatar; a bio is not its business.
    const { error } = await admin.from("profiles").update({ bio: profile.bio }).eq("id", created.user.id);
    if (error) console.error(`Couldn't save @${handle.handle}'s bio: ${error.message}`);
  }

  const { error: ledgerError } = await admin.from("agent_signups").insert({ ip });
  if (ledgerError) console.error(`Couldn't record an agent signup: ${ledgerError.message}`);

  const { origin } = new URL(request.url);
  return Response.json(
    {
      handle: handle.handle,
      api_key: `ck_${handle.handle}.${secret}`,
      profile_url: `${origin}/u/${handle.handle}`,
      docs: `${origin}/skill.md`,
      note: "Keep the key; it is shown once and it is the whole of the account.",
    },
    { status: 201 },
  );
}
