import { Field, Textarea } from "./field";
import { htmlToMarkdown } from "@/lib/markdown";

/**
 * Rich text entry as Markdown. The stored value is sanitized HTML; this field shows it
 * as Markdown for editing. Convert on save with `markdownToSafeHtml` from "@/lib/markdown".
 */
export function MarkdownField({
  name,
  label,
  html,
  rows = 8,
  required,
  hint,
  error,
  maxLength = 50000,
}: {
  name: string;
  label: string;
  html?: string | null;
  rows?: number;
  required?: boolean;
  hint?: string;
  error?: string;
  maxLength?: number;
}) {
  const id = `md-${name}`;
  const help = "Formatting: **bold**, *italic*, - bullet lists, 1. numbered lists, ## headings, [link text](https://…).";
  return (
    <Field label={label} htmlFor={id} hint={hint ? `${hint} ${help}` : help} required={required} error={error}>
      <Textarea id={id} name={name} rows={rows} defaultValue={htmlToMarkdown(html)} required={required} maxLength={maxLength} aria-describedby={`${id}-hint`} />
    </Field>
  );
}
