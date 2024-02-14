import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { User, createServerActionClient } from "@supabase/auth-helpers-nextjs";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default function NewPeel({ user }: { user: User }) {
  const addPeel = async (formData: FormData) => {
    "use server";
    const title = String(formData.get("title"));
    const supabase = createServerActionClient<Database>({ cookies });
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
