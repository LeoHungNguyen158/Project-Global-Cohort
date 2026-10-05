import sanitizeHtml from "sanitize-html";

/**
 * Rich text allowlist. Applied when saving AND again when rendering, so content that
 * reaches the database through any path is still rendered safely.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "blockquote", "code", "pre",
    "ul", "ol", "li", "h2", "h3", "h4", "a", "hr", "table", "thead", "tbody", "tr", "th", "td",
  ],
  // rel/target are listed so the link transform below survives filtering; their values are always overwritten.
  allowedAttributes: { a: ["href", "title", "rel", "target"], th: ["scope"], td: ["colspan", "rowspan"] },
  allowedSchemes: ["https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" },
    }),
  },
};

export function sanitizeRichText(html: string | null | undefined): string {
  return sanitizeHtml(html ?? "", OPTIONS);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Convert plain text (e.g. a textarea) to safe paragraphs; markup is shown literally, never dropped. */
export function plainTextToHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, "\n").trim())
    .split(/\n{2,}/)
    .filter((para) => para.trim() !== "")
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
