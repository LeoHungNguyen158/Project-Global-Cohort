import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToSafeHtml } from "@/lib/markdown";

describe("markdownToSafeHtml", () => {
  it("renders common Markdown", () => {
    const html = markdownToSafeHtml("## Week 1\n\nRead **chapter 2** and *skim* chapter 3.\n\n- one\n- two");
    expect(html).toContain("<h2>Week 1</h2>");
    expect(html).toContain("<strong>chapter 2</strong>");
    expect(html).toContain("<em>skim</em>");
    expect(html).toContain("<ul>");
  });

  it("sanitizes raw HTML and unsafe links written inside Markdown", () => {
    const html = markdownToSafeHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) [ok](https://example.test)');
    expect(html).not.toMatch(/<script|<img|onerror|javascript:/i);
    expect(html).toContain('<a href="https://example.test" rel="noopener noreferrer nofollow" target="_blank">ok</a>');
  });

  it("turns single newlines into line breaks", () => {
    expect(markdownToSafeHtml("line one\nline two")).toBe("<p>line one<br />line two</p>");
  });

  it("returns an empty string for empty input", () => {
    expect(markdownToSafeHtml("   \r\n ")).toBe("");
    expect(markdownToSafeHtml(null)).toBe("");
  });

  it("keeps Vietnamese text", () => {
    expect(markdownToSafeHtml("Chào **Trần Thị Mai**")).toBe("<p>Chào <strong>Trần Thị Mai</strong></p>");
  });
});

describe("htmlToMarkdown", () => {
  it("round-trips the Markdown authors typically write", () => {
    const source = "## Goals\n\nBuild an **agent loop** with *care*.\n\n- Plan\n- Act\n\n```\nprint(\"hi\")\n```\n\nSee [the guide](https://example.test/guide).";
    const back = htmlToMarkdown(markdownToSafeHtml(source));
    expect(back).toContain("## Goals");
    expect(back).toContain("**agent loop**");
    expect(back).toContain("*care*");
    expect(back).toMatch(/^-\s+Plan$/m);
    expect(back).toContain('print("hi")');
    expect(back).toContain("[the guide](https://example.test/guide)");
    // Converting again is stable.
    expect(htmlToMarkdown(markdownToSafeHtml(back))).toBe(back);
  });

  it("drops anything the sanitizer would drop", () => {
    expect(htmlToMarkdown('<p>ok</p><script>alert(1)</script>')).toBe("ok");
  });
});
