"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { t } from "@/i18n";

export type FlashMessage = { tone: "success" | "warning" | "info" | "error"; message: string; details?: string[] };
type Stored = FlashMessage & { id: number };

// Outcome of the last administration action, kept outside the component that ran it:
// the row or panel that triggered an action often disappears once the page refreshes
// (a revoked invitation leaves the "pending" list), and the result must stay visible.
let current: Stored | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function pushFlash(message: FlashMessage) {
  current = { ...message, id: ++seq };
  emit();
}

function clearFlash() {
  if (current) {
    current = null;
    emit();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announces the latest action outcome until it is dismissed or the person leaves the page. */
export function FlashRegion() {
  const flash = useSyncExternalStore(subscribe, () => current, () => null);
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearFlash();
  }, [pathname]);
  return (
    <div aria-live="polite" data-testid="admin-flash" className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-4 lg:left-[232px]">
      {flash ? (
        <div key={flash.id} className="pointer-events-auto w-full max-w-2xl shadow-lg">
          <Alert tone={flash.tone} className="items-start pr-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p>{flash.message}</p>
                {flash.details && flash.details.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {flash.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button type="button" onClick={clearFlash} className="-my-1 rounded-md p-2 hover:bg-white/60" aria-label={t("admin.common.dismiss")}>
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </Alert>
        </div>
      ) : null}
    </div>
  );
}
