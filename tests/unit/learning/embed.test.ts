import { describe, expect, it } from "vitest";
import { embedPlayerUrl, embedWatchUrl, isAllowedEmbed, parseEmbedUrl } from "@/lib/learning/embed";

describe("embedded video links (allowlist: YouTube, Vimeo)", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://www.youtube.com/live/dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("accepts YouTube link %s", (url, id) => {
    expect(parseEmbedUrl(url)).toEqual({ ok: true, provider: "youtube", id });
  });

  it.each([
    ["https://vimeo.com/76979871", "76979871"],
    ["https://www.vimeo.com/76979871#t=3", "76979871"],
    ["https://player.vimeo.com/video/76979871?h=abc", "76979871"],
    ["https://vimeo.com/channels/staffpicks/76979871", "76979871"],
  ])("accepts Vimeo link %s", (url, id) => {
    expect(parseEmbedUrl(url)).toEqual({ ok: true, provider: "vimeo", id });
  });

  it("rejects other providers, plain http, raw iframe markup and links without an id", () => {
    expect(parseEmbedUrl("https://evil.example/embed/dQw4w9WgXcQ")).toEqual({ ok: false, reason: "provider" });
    expect(parseEmbedUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toEqual({ ok: false, reason: "provider" });
    expect(parseEmbedUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ ok: false, reason: "not_https" });
    expect(parseEmbedUrl('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>')).toEqual({ ok: false, reason: "markup" });
    expect(parseEmbedUrl("javascript:alert(1)")).toEqual({ ok: false, reason: "not_https" });
    expect(parseEmbedUrl("https://www.youtube.com/watch?v=short")).toEqual({ ok: false, reason: "no_id" });
    expect(parseEmbedUrl("https://www.youtube.com/channel/UC123")).toEqual({ ok: false, reason: "no_id" });
    expect(parseEmbedUrl("https://vimeo.com/about")).toEqual({ ok: false, reason: "no_id" });
    expect(parseEmbedUrl("https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ ok: false, reason: "invalid_url" });
    expect(parseEmbedUrl("not a url")).toEqual({ ok: false, reason: "invalid_url" });
    expect(parseEmbedUrl("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("builds player URLs only from the fixed templates the CSP allows", () => {
    expect(embedPlayerUrl("youtube", "dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
    expect(embedPlayerUrl("vimeo", "76979871")).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(embedWatchUrl("youtube", "dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    // Stored values that do not fit the provider's id format are never rendered.
    expect(embedPlayerUrl("vimeo", "dQw4w9WgXcQ")).toBeNull();
    expect(embedPlayerUrl("youtube", "../../x")).toBeNull();
    expect(isAllowedEmbed("dailymotion", "x7tgad0")).toBe(false);
    expect(isAllowedEmbed("youtube", "dQw4w9WgXcQ")).toBe(true);
  });
});
