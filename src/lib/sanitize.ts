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
  allowedAttributes: { a: ["href", "title"], th: ["scope"], td: ["colspan", "rowspan"] },
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

/** Convert plain text (e.g. a textarea) to safe paragraphs. */
export function plainTextToHtml(text: string): string {
  const escaped = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
