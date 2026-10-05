import "server-only";
import { Marked } from "marked";
import TurndownService from "turndown";
import { sanitizeRichText } from "./sanitize";

// Authors write Markdown; the database stores sanitized HTML. Editing converts the
// stored HTML back to Markdown, so no separate source column is needed. Anything the
// sanitizer does not allow is dropped in both directions.

const marked = new Marked({ gfm: true, breaks: true, async: false });

export function markdownToSafeHtml(markdown: string | null | undefined): string {
  const source = (markdown ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return "";
  return sanitizeRichText(marked.parse(source) as string);
}

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

export function htmlToMarkdown(html: string | null | undefined): string {
  const safe = sanitizeRichText(html);
  if (!safe) return "";
  return turndown.turndown(safe).trim();
}
