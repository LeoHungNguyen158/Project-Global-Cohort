"use client";
import { useActionState } from "react";
import { Star } from "lucide-react";
import { toggleFavorite } from "@/app/actions/courses";

/** Star toggle. The pressed state reflects the server's stored favorite after each change. */
export function FavoriteButton({ offeringId, title, favorite }: { offeringId: string; title: string; favorite: boolean }) {
  const [state, action, pending] = useActionState(toggleFavorite, null);
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="offering_id" value={offeringId} />
      <input type="hidden" name="favorite" value={favorite ? "0" : "1"} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-canvas disabled:opacity-60"
      >
        <Star aria-hidden="true" className={favorite ? "h-5 w-5 fill-[#f59e0b] text-[#b45309]" : "h-5 w-5"} />
      </button>
      {state && !state.ok ? <span role="alert" className="sr-only">{state.error}</span> : null}
    </form>
  );
}
