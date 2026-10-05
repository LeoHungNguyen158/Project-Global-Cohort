import { Field, Textarea } from "./field";
import { htmlToMarkdown } from "@/lib/markdown";
import { t } from "@/i18n";

/**
 * Rich text entry as Markdown. The stored value is sanitized HTML; this field shows it
 * as Markdown for editing. Convert on save with `markdownToSafeHtml` from "@/lib/markdown".
 */
export function MarkdownField({
  name,
  id: idProp,
  label,
  html,
  rows = 8,
  required,
  hint,
  error,
  maxLength = 50000,
}: {
  name: string;
  /** Needed when several forms on one page use the same field name. */
  id?: string;
  label: string;
  html?: string | null;
  rows?: number;
  required?: boolean;
  hint?: string;
  error?: string;
  maxLength?: number;
}) {
  const id = idProp ?? `md-${name}`;
  const help = t("common.markdownHelp");
  return (
    <Field label={label} htmlFor={id} hint={hint ? `${hint} ${help}` : help} required={required} error={error}>
      <Textarea id={id} name={name} rows={rows} defaultValue={htmlToMarkdown(html)} required={required} maxLength={maxLength} aria-describedby={`${id}-hint`} />
    </Field>
  );
}
