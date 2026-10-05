import Link from "next/link";
import { createTopic } from "@/app/actions/discussions";
import { ResilientForm, ResilientSubmit } from "@/components/messages/resilient-form";
import { buttonClass } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import type { DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";
import { PostBodyField } from "./post-body-field";

/** New topic form; pin/lock options appear only for the scope's moderators. */
export function TopicEditor({ scope, moderator, cancelHref }: { scope: DiscussionScope; moderator: boolean; cancelHref: string }) {
  return (
    <ResilientForm action={createTopic} className="space-y-5" aria-label={t("disc.createTitle")} failureMessage={t("disc.errCreateUnconfirmed")}>
      <input type="hidden" name="scopeType" value={scope.type} />
      <input type="hidden" name="scopeId" value={scope.id} />
      <Field label={t("disc.formTitle")} htmlFor="topic-title" required>
        <Input id="topic-title" name="title" required maxLength={300} autoComplete="off" />
      </Field>
      <PostBodyField id="topic-body" label={t("disc.formBody")} rows={8} required={false} />
      {moderator ? (
        <div className="space-y-1">
          <Checkbox name="pinned" label={t("disc.formPinned")} />
          <Checkbox name="locked" label={t("disc.formLocked")} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <ResilientSubmit pendingText={t("disc.creating")}>{t("disc.create")}</ResilientSubmit>
        <Link href={cancelHref} className={buttonClass("ghost")}>
          {t("msg.cancel")}
        </Link>
      </div>
    </ResilientForm>
  );
}
