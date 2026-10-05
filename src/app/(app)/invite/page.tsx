import { redirect } from "next/navigation";

// /invite has no page of its own; invitations are listed and accepted at /invite/accept.
export default function InviteIndex() {
  redirect("/invite/accept");
}
