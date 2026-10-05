"use client";
import { useActionState, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { requestAccess, withdrawAccessRequest } from "@/app/actions/catalog";
import type { ActionResult } from "@/lib/errors";
import { t } from "@/i18n";

/**
 * Request access / request pending for one catalog entry. The same component renders
 * both states, so it stays mounted when the page refreshes after a request and the
 * confirmed result is still announced. Results come only from the server's response.
 */
export function RequestControl({
  offeringId,
  title,
  state,
  requestId,
  pendingNote,
  declinedNote,
}: {
  offeringId: string;
  title: string;
  state: "can_request" | "requested";
  requestId: string | null;
  pendingNote: string;
  declinedNote?: string | null;
}) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [requestState, requestAction] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await requestAccess(prev, formData);
    if (result.ok) {
      setRequestOpen(false);
      setNotice(result.message ?? t("catalog.requestSent"));
    }
    return result;
  }, null);
  const [withdrawState, withdrawAction] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await withdrawAccessRequest(prev, formData);
    if (result.ok) {
      setWithdrawOpen(false);
      setNotice(result.message ?? t("catalog.withdrawn"));
    }
    return result;
  }, null);

  const messageId = `request-message-${offeringId}`;

  return (
    <div className="space-y-2">
      {state === "requested" ? (
        <>
          <Badge tone="warning">{t("catalog.state.requested")}</Badge>
          <p className="text-sm text-muted">{pendingNote}</p>
          {requestId ? (
            <button
              type="button"
              className={buttonClass("secondary", "sm")}
              aria-label={t("catalog.withdrawFor", { title })}
              onClick={() => {
                setNotice(null);
                setWithdrawOpen(true);
              }}
            >
              {t("catalog.withdraw")}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <Badge tone="info">{t("catalog.state.can_request")}</Badge>
          {declinedNote ? <p className="text-sm text-muted">{declinedNote}</p> : null}
          <button
            type="button"
            className={buttonClass("primary", "sm")}
            aria-label={t("catalog.requestFor", { title })}
            onClick={() => {
              setNotice(null);
              setRequestOpen(true);
            }}
          >
            {t("catalog.request")}
          </button>
        </>
      )}

      <div aria-live="polite" className="min-h-0">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
      </div>

      <Dialog open={requestOpen} onClose={() => setRequestOpen(false)} title={t("catalog.requestFor", { title })} description={t("catalog.requestDialogBody")}>
        <form action={requestAction} onSubmit={submitWithoutReset(requestAction)} className="space-y-4">
          <input type="hidden" name="offering_id" value={offeringId} />
          <Field label={t("catalog.requestMessage")} htmlFor={messageId} hint={t("catalog.requestMessageHint")}>
            <Textarea id={messageId} name="message" rows={4} maxLength={2000} aria-describedby={`${messageId}-hint`} />
          </Field>
          {requestState && !requestState.ok ? <Alert tone="error" live>{requestState.error}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => setRequestOpen(false)}>
              {t("catalog.cancel")}
            </button>
            <SubmitButton pendingText={t("catalog.sending")}>{t("catalog.sendRequest")}</SubmitButton>
          </div>
        </form>
      </Dialog>

      {requestId ? (
        <Dialog open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title={t("catalog.withdrawTitle")} description={t("catalog.withdrawBody")}>
          <form action={withdrawAction} onSubmit={submitWithoutReset(withdrawAction)} className="space-y-4">
            <input type="hidden" name="request_id" value={requestId} />
            <p className="font-medium">{title}</p>
            {withdrawState && !withdrawState.ok ? <Alert tone="error" live>{withdrawState.error}</Alert> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={buttonClass("secondary")} onClick={() => setWithdrawOpen(false)}>
                {t("catalog.cancel")}
              </button>
              <SubmitButton variant="danger" pendingText={t("catalog.withdrawing")}>{t("catalog.withdraw")}</SubmitButton>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
