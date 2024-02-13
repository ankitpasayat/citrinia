import { createServerActionClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default function NewPeel() {
  const addPeel = async (formData: FormData) => {
    "use server";
    const title = String(formData.get("title"));
    const supabase = createServerActionClient<Database>({ cookies });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("peels").insert({ title: title, user_id: user.id });
    }
  };

  return (
    <form action={addPeel}>
      <input name="title" className="bg-red-400" />
    </form>
  );
}
