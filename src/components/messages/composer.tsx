"use client";
import { useId, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, Search, Send, X } from "lucide-react";
import { sendNewMessage } from "@/app/actions/messages";
import type { UploadedAsset } from "@/components/uploads/file-uploader";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { newClientKey } from "@/lib/comms/messages";
import { threadPath } from "@/lib/comms/paths";
import {
  matchesQuery, matchesRoleFilter, needsGroupConfirmation, parseRoleFilter, PICKER_PAGE, type Recipient, type RoleFilter,
} from "@/lib/comms/recipients";
import type { ScopeType } from "@/lib/comms/scope";
import { t, type CommsKey as MessageKey } from "@/i18n/client/comms";
import { AttachmentPicker } from "./attachment-picker";

const ROLE_LABEL: Record<Recipient["role"], MessageKey> = {
  instructor: "msg.role.instructor",
  ta: "msg.role.ta",
  coordinator: "msg.role.coordinator",
  learner: "msg.role.learner",
  participant: "msg.role.participant",
};

/** Chips listed before the rest of a large selection is summarized. */
const CHIP_LIMIT = 24;

type Problem = { message: string; retry: boolean };

/**
 * New conversation in one course or cohort. The recipient list holds only people the
 * database accepts for this scope (comms_recipients); sending more than ten people
 * asks for confirmation first. A failed send keeps everything typed and offers a retry
 * that reuses the same idempotency key, so a send that did reach the server is never
 * duplicated. Success opens the new conversation.
 */
export function Composer({
  scope,
  recipients,
  initialSelection,
  cancelHref,
}: {
  scope: { type: ScopeType; id: string; code: string; title: string };
  recipients: Recipient[];
  initialSelection: string[];
  cancelHref: string;
}) {
  const router = useRouter();
  const ids = { search: useId(), role: useId(), list: useId(), subject: useId(), body: useId(), count: useId() };
  const formRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<string | null>(null);
  const confirmedRef = useRef(false);
  const [selected, setSelected] = useState<string[]>(initialSelection);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [attachments, setAttachments] = useState<UploadedAsset[]>([]);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(recipients.map((r) => [r.id, r])), [recipients]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const matches = useMemo(
    () => recipients.filter((r) => matchesRoleFilter(r.role, role) && matchesQuery(r.name, query)),
    [recipients, role, query],
  );
  const shown = matches.slice(0, PICKER_PAGE);
  const unselectedMatches = matches.filter((r) => !selectedSet.has(r.id)).length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => (on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  }

  function selectMatching() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of matches) next.add(r.id);
      return recipients.filter((r) => next.has(r.id)).map((r) => r.id);
    });
  }

  function send(confirmLarge: boolean) {
    const form = formRef.current;
    if (!form || pending) return;
    if (selected.length === 0) {
      setProblem({ message: t("msg.needRecipient"), retry: false });
      searchRef.current?.focus();
      return;
    }
    if (!form.reportValidity()) return;
    if (!confirmLarge && needsGroupConfirmation(selected.length)) {
      setConfirming(selected.length);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setConfirming(null);
      setProblem({ message: t("msg.offline"), retry: true });
      return;
    }
    confirmedRef.current = confirmLarge;
    keyRef.current ??= newClientKey();
    const formData = new FormData(form);
    formData.set("clientKey", keyRef.current);
    formData.set("confirmLarge", confirmLarge ? "1" : "");
    setProblem(null);
    startTransition(async () => {
      try {
        const result = await sendNewMessage(formData);
        if (result.ok && result.data) {
          keyRef.current = null;
          setConfirming(null);
          router.push(`${threadPath(result.data.threadId)}?sent=1`);
          return;
        }
        if (!result.ok && result.confirmCount) {
          setConfirming(result.confirmCount);
          return;
        }
        setConfirming(null);
        setProblem({ message: result.ok ? t("msg.sendFailed") : result.error, retry: false });
      } catch {
        setConfirming(null);
        setProblem({ message: t("msg.networkFailed"), retry: true });
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(false);
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    // Enter in the search box filters; it must not send the message.
    if (event.key === "Enter") event.preventDefault();
  }

  const chips = selected.slice(0, CHIP_LIMIT).map((id) => byId.get(id)).filter((r): r is Recipient => Boolean(r));
  const countText = selected.length === 0 ? t("msg.selectedNone") : selected.length === 1 ? t("msg.selectedOne") : t("msg.selectedCount", { count: selected.length });

  return (
    <>
      <form ref={formRef} onSubmit={onSubmit} className="space-y-6" aria-busy={pending || undefined}>
        <input type="hidden" name="scopeType" value={scope.type} />
        <input type="hidden" name="scopeId" value={scope.id} />
        {selected.map((id) => (
          <input key={id} type="hidden" name="to" value={id} />
        ))}

        <fieldset className="space-y-3" aria-describedby={`${ids.list}-hint`}>
          <legend className="text-sm font-medium">
            {t("msg.to")}
            <span className="text-danger"> *<span className="sr-only"> (required)</span></span>
          </legend>
          <p id={`${ids.list}-hint`} className="text-xs text-muted">{t("msg.toHelp", { code: scope.code })}</p>

          {recipients.length === 0 ? (
            <Alert tone="info">{t("msg.noRecipients")}</Alert>
          ) : (
            <>
              <div>
                <p className="sr-only">{t("msg.selectedHeading")}</p>
                <p id={ids.count} className="text-sm font-medium" aria-live="polite">{countText}</p>
                {chips.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("msg.selectedHeading")}>
                    {chips.map((r) => (
                      <li key={r.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#c7d6fb] bg-primary-soft py-0.5 pl-3 pr-1 text-sm">
                        <span className="min-w-0 break-words">{r.name}</span>
                        <button
                          type="button"
                          onClick={() => toggle(r.id, false)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white"
                          aria-label={t("msg.removeRecipient", { name: r.name })}
                        >
                          <X aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                    {selected.length > chips.length ? (
                      <li className="self-center text-sm text-muted">{t("msg.andMore", { count: selected.length - chips.length })}</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-[1_1_16rem] space-y-1">
                  <label htmlFor={ids.search} className="block text-sm font-medium">{t("msg.search", { code: scope.code })}</label>
                  <div className="relative">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <Input
                      ref={searchRef}
                      id={ids.search}
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={onSearchKey}
                      className="pl-9"
                      autoComplete="off"
                      aria-controls={ids.list}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor={ids.role} className="block text-sm font-medium">{t("msg.roleFilterLabel")}</label>
                  <Select id={ids.role} value={role} onChange={(e) => setRole(parseRoleFilter(e.target.value))} aria-controls={ids.list}>
                    <option value="all">{t("msg.roleAll")}</option>
                    <option value="staff">{t("msg.roleStaff")}</option>
                    <option value="learners">{t("msg.roleLearners")}</option>
                  </Select>
                </div>
              </div>

              <div id={ids.list} className="max-h-80 overflow-y-auto rounded-md border border-line bg-panel" role="group" aria-label={t("msg.peopleList", { code: scope.code })}>
                {shown.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted">{t("msg.noMatches", { code: scope.code, query: query.trim() })}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {shown.map((r) => (
                      <li key={r.id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-canvas">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                            checked={selectedSet.has(r.id)}
                            onChange={(e) => toggle(r.id, e.target.checked)}
                          />
                          <span className="min-w-0 flex-1 break-words">{r.name}</span>
                          <Badge tone={r.role === "learner" || r.role === "participant" ? "neutral" : "info"}>{t(ROLE_LABEL[r.role])}</Badge>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {matches.length > shown.length ? (
                <p className="text-sm text-muted">{t("msg.showingFirst", { shown: shown.length, total: matches.length })}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass("secondary", "sm")} onClick={selectMatching} disabled={unselectedMatches === 0}>
                  {t("msg.selectMatching", { count: matches.length })}
                </button>
                <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setSelected([])} disabled={selected.length === 0}>
                  {t("msg.clearSelection")}
                </button>
              </div>
            </>
          )}
        </fieldset>

        <Field label={t("msg.subject")} htmlFor={ids.subject} required>
          <Input id={ids.subject} name="subject" required maxLength={300} autoComplete="off" />
        </Field>
        <Field label={t("msg.body")} htmlFor={ids.body} hint={t("msg.bodyHelp")} required>
          <Textarea id={ids.body} name="body" required rows={8} maxLength={20000} aria-describedby={`${ids.body}-hint`} />
        </Field>

        <AttachmentPicker value={attachments} onChange={setAttachments} uploaderKey="compose" disabled={pending} />

        <div aria-live="polite" className="empty:hidden">
          {problem ? (
            <Alert tone="error">
              <p>{problem.message}</p>
              {problem.retry ? (
                <button type="button" className={`${buttonClass("secondary", "sm")} mt-2`} onClick={() => send(confirmedRef.current)}>
                  <RotateCcw aria-hidden="true" className="h-4 w-4" /> {t("msg.tryAgain")}
                </button>
              ) : null}
            </Alert>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass("primary")} disabled={pending || recipients.length === 0} aria-disabled={pending || undefined}>
            <Send aria-hidden="true" className="h-4 w-4" />
            {pending ? t("msg.sending") : t("msg.send")}
          </button>
          <Link href={cancelHref} className={buttonClass("ghost")}>
            {t("msg.cancel")}
          </Link>
        </div>
      </form>

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t("msg.confirmTitle", { count: confirming ?? selected.length })}
        description={t("msg.confirmBody", { count: confirming ?? selected.length, code: scope.code })}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass("secondary")} onClick={() => setConfirming(null)} disabled={pending}>
            {t("msg.cancel")}
          </button>
          <button type="button" className={buttonClass("primary")} onClick={() => send(true)} disabled={pending}>
            {pending ? t("msg.sending") : t("msg.confirmSend", { count: confirming ?? selected.length })}
          </button>
        </div>
      </Dialog>
    </>
  );
}
