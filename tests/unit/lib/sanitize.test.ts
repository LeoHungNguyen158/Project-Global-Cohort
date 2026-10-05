import { describe, expect, it } from "vitest";
import { plainTextToHtml, sanitizeRichText } from "@/lib/sanitize";

describe("sanitizeRichText", () => {
  it("removes scripts, event handlers and inline styles", () => {
    const out = sanitizeRichText('<p onclick="steal()" style="color:red">Hi<script>alert(1)</script></p>');
    expect(out).toBe("<p>Hi</p>");
  });

  it("drops images, iframes, forms and svg entirely", () => {
    const out = sanitizeRichText(
      '<img src="x" onerror="alert(1)"><iframe src="https://evil.test"></iframe><form action="/x"><input name="a"></form><svg><script>alert(1)</script></svg>ok',
    );
    expect(out).not.toMatch(/<(img|iframe|form|input|svg|script)/i);
    expect(out).toContain("ok");
  });

  it("removes javascript:, data: and protocol-relative link targets", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "//evil.test/x", "http://plain.test"]) {
      const out = sanitizeRichText(`<a href="${href}">x</a>`);
      expect(out, href).not.toContain("href=");
    }
  });

  it("keeps https and mailto links and forces safe rel/target values", () => {
    const out = sanitizeRichText('<a href="https://example.test/a?b=1" rel="opener" target="_self">docs</a>');
    expect(out).toBe('<a href="https://example.test/a?b=1" rel="noopener noreferrer nofollow" target="_blank">docs</a>');
    expect(sanitizeRichText('<a href="mailto:help@example.test">mail</a>')).toContain('href="mailto:help@example.test"');
  });

  it("keeps structural formatting and drops the page-level h1 tag but not its text", () => {
    const out = sanitizeRichText("<h1>Top</h1><h2>Section</h2><ul><li><strong>a</strong></li></ul><pre><code>x &lt; y</code></pre>");
    expect(out).toBe("Top<h2>Section</h2><ul><li><strong>a</strong></li></ul><pre><code>x &lt; y</code></pre>");
  });

  it("preserves Vietnamese text exactly", () => {
    const text = "Học máy cơ bản – Trần Thị Mai, Phạm Linh: “Nhập môn” đã được cập nhật.";
    expect(sanitizeRichText(`<p>${text}</p>`)).toBe(`<p>${text}</p>`);
  });

  it("treats null and undefined as empty", () => {
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
  });
});

describe("plainTextToHtml", () => {
  it("escapes markup and keeps paragraphs and line breaks", () => {
    expect(plainTextToHtml("Hello <b>there</b>\nline two\n\nNext para")).toBe("<p>Hello &lt;b&gt;there&lt;/b&gt;<br>line two</p><p>Next para</p>");
  });

  it("shows code-like text literally instead of dropping it", () => {
    expect(plainTextToHtml('Use a <div> & "quotes"\r\n\r\n\r\n')).toBe("<p>Use a &lt;div&gt; &amp; &quot;quotes&quot;</p>");
  });
});
