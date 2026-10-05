"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import { safeNextPath } from "@/lib/safe-redirect";

/** Marks one notification read (own rows only, by RLS) and opens its target page. */
export async function openNotification(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (!isUuid(id)) redirect("/activity");
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select("target_url")
    .maybeSingle();
  redirect(safeNextPath(data?.target_url ?? "/activity", "/activity"));
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", auth.user.id).is("read_at", null);
  revalidatePath("/activity");
}
