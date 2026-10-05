import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/forms";
import { communityPath } from "@/lib/comms/paths";

// A community lists its topics on its own page.
export default async function CommunityTopicsIndex({ params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  if (!isUuid(communityId)) notFound();
  redirect(`${communityPath(communityId)}#topics`);
}
