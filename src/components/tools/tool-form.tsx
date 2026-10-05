import Link from "next/link";
import { saveToolResource } from "@/app/actions/tools";
import { ActionForm } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { MarkdownField } from "@/components/ui/markdown-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";
import { TOOL_BODY_MAX, TOOL_CATEGORIES, TOOL_DESCRIPTION_MAX, TOOL_POSITION_MAX, TOOL_TITLE_MAX, TOOL_URL_MAX, scopeValue, type ToolScope } from "./validation";
import { scopeFormLabel, type ScopeDirectory, type ToolRow } from "./scopes";

/**
 * Add/edit form for a Tools entry. Only scopes the person manages are offered; the
 * server action checks the scope again and RLS enforces it a third time.
 */
export function ToolForm({
  row,
  scopes,
  dir,
  defaultScope,
  returnTo,
}: {
  row: ToolRow | null;
  scopes: ToolScope[];
  dir: ScopeDirectory;
  defaultScope: string;
  returnTo: string;
}) {
  return (
    <ActionForm action={saveToolResource} className="max-w-3xl space-y-5">
      {row ? <input type="hidden" name="tool_id" value={row.id} /> : null}
      <input type="hidden" name="return_to" value={returnTo} />

      <Field label={t("tools.form.scope")} htmlFor="tool-scope" hint={t("tools.form.scopeHint")} required>
        <Select id="tool-scope" name="scope" defaultValue={defaultScope} required aria-describedby="tool-scope-hint">
          {scopes.map((s) => (
            <option key={scopeValue(s)} value={scopeValue(s)}>
              {scopeFormLabel(s, dir)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("tools.form.category")} htmlFor="tool-category" required>
        <Select id="tool-category" name="category" defaultValue={row?.category ?? "resource"} required>
          {TOOL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`tools.category.${c}`)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("tools.form.title")} htmlFor="tool-title" required>
        <Input id="tool-title" name="title" defaultValue={row?.title ?? ""} required maxLength={TOOL_TITLE_MAX} autoComplete="off" />
      </Field>

      <Field label={t("tools.form.description")} htmlFor="tool-description" hint={t("tools.form.descriptionHint")}>
        <Textarea
          id="tool-description"
          name="description"
          rows={3}
          maxLength={TOOL_DESCRIPTION_MAX}
          defaultValue={row?.description ?? ""}
          aria-describedby="tool-description-hint"
          className="min-h-20"
        />
      </Field>

      <Field label={t("tools.form.url")} htmlFor="tool-url" hint={t("tools.form.urlHint")}>
        <Input
          id="tool-url"
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://"
          maxLength={TOOL_URL_MAX}
          defaultValue={row?.url ?? ""}
          aria-describedby="tool-url-hint"
          autoComplete="off"
        />
      </Field>

      <MarkdownField name="body" label={t("tools.form.body")} hint={t("tools.form.bodyHint")} html={row?.body_html} rows={8} maxLength={TOOL_BODY_MAX} />

      <Field label={t("tools.form.position")} htmlFor="tool-position" hint={t("tools.form.positionHint")}>
        <Input
          id="tool-position"
          name="position"
          type="number"
          inputMode="numeric"
          min={0}
          max={TOOL_POSITION_MAX}
          step={1}
          defaultValue={row?.position ?? 0}
          aria-describedby="tool-position-hint"
          className="max-w-36"
        />
      </Field>

      <div>
        <Checkbox
          name="published"
          label={t("tools.form.published")}
          defaultChecked={row ? row.published : true}
          aria-describedby="tool-published-hint"
        />
        <p id="tool-published-hint" className="text-xs text-muted">{t("tools.form.publishedHint")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText={t("common.working")}>{t("tools.form.save")}</SubmitButton>
        <Link href={returnTo} className={buttonClass("secondary")}>{t("tools.form.cancel")}</Link>
      </div>
    </ActionForm>
  );
}
