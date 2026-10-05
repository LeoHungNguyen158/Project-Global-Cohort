import { sanitizeRichText } from "@/lib/sanitize";

/** Renders stored rich text after re-sanitizing it on the server. */
export function RichText({ html, className = "" }: { html: string | null | undefined; className?: string }) {
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }} />;
}
