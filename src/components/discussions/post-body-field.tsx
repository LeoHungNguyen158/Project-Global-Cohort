import { Field, Textarea } from "@/components/ui/field";
import { htmlToMarkdown } from "@/lib/markdown";
import { t } from "@/i18n";

/**
 * Markdown entry for a discussion post with an id unique on the page (a topic page
 * holds many reply and edit forms). Stored HTML is shown back as Markdown for editing;
 * the server converts and sanitizes it again on save.
 */
export function PostBodyField({ id, label, html, rows = 5, required = true }: { id: string; label: string; html?: string | null; rows?: number; required?: boolean }) {
  return (
    <Field label={label} htmlFor={id} hint={`${t("disc.formatHelp")} ${t("disc.formatNote")}`} required={required}>
      <Textarea id={id} name="body" rows={rows} defaultValue={htmlToMarkdown(html)} required={required} maxLength={20000} aria-describedby={`${id}-hint`} />
    </Field>
  );
}
