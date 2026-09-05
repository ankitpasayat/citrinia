import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";
import { User } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export default function NewPeel({ user }: { user: User }) {
  const addPeel = async (formData: FormData) => {
    "use server";
    const title = String(formData.get("title"));
    const supabase = await createClient();
    await supabase.from("peels").insert({ title: title, user_id: user.id });
    revalidatePath("/");
  };

  return (
    <form action={addPeel}>
      <Avatar>
        <AvatarImage src={user.user_metadata.avatar_url} />
        <AvatarFallback>pfp</AvatarFallback>
      </Avatar>
      <Input
        name="title"
        className="size-auto"
        placeholder="how are you peeling!?"
      />
    </form>
  );
}
