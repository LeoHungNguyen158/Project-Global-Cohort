import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { signatureMatches } from "@/lib/uploads/signature";
import { formatBytes, guessMime } from "@/lib/uploads/mime";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? Array.from(v, (c) => c.charCodeAt(0)) : [v])));
const head = (file: string) => new Uint8Array(readFileSync(resolve(__dirname, "../../../seed/assets", file)).subarray(0, 4096));

describe("signatureMatches", () => {
  it("accepts the real sample files for their declared types", () => {
    expect(signatureMatches("application/pdf", head("agent-architectures-reading.pdf"))).toBe(true);
    expect(signatureMatches("video/mp4", head("sample-lecture.mp4"))).toBe(true);
    expect(signatureMatches("video/webm", head("sample-lecture.webm"))).toBe(true);
    expect(signatureMatches("text/vtt", head("sample-lecture.en.vtt"))).toBe(true);
    expect(signatureMatches("text/plain", head("starter_agent_loop.py"))).toBe(true);
  });

  it("rejects a file whose bytes do not match its declared type", () => {
    const html = bytes("<!doctype html><script>alert(1)</script>");
    expect(signatureMatches("application/pdf", html)).toBe(false);
    expect(signatureMatches("image/png", html)).toBe(false);
    expect(signatureMatches("video/mp4", head("sample-lecture.webm"))).toBe(false);
    expect(signatureMatches("application/pdf", head("sample-lecture.mp4"))).toBe(false);
    // Windows executable renamed to .docx
    expect(signatureMatches("application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes("MZ", 0x90, 0x00))).toBe(false);
  });

  it("recognizes image signatures", () => {
    expect(signatureMatches("image/png", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(signatureMatches("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(signatureMatches("image/gif", bytes("GIF89a", 1, 0))).toBe(true);
    expect(signatureMatches("image/webp", bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe(true);
    expect(signatureMatches("image/webp", bytes("RIFF", 0, 0, 0, 0, "WAVEfmt "))).toBe(false);
  });

  it("accepts Office documents only as ZIP containers", () => {
    expect(signatureMatches("application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes("PK", 3, 4, 20, 0))).toBe(true);
  });

  it("checks captions and text as UTF-8 without NUL bytes", () => {
    expect(signatureMatches("text/vtt", bytes(0xef, 0xbb, 0xbf, "WEBVTT\n\n00:00.000 --> 00:01.000\nXin chào"))).toBe(true);
    expect(signatureMatches("text/vtt", bytes("1\n00:00:00,000 --> 00:00:01,000\nSRT, not VTT"))).toBe(false);
    expect(signatureMatches("text/plain", bytes("print('hi')", 0, "x"))).toBe(false);
    expect(signatureMatches("text/csv", bytes(0xc3, 0x28, "a,b"))).toBe(false);
    const viet = new TextEncoder().encode("Tên,Điểm\nTrần Thị Mai,9.5\n");
    expect(signatureMatches("text/csv", viet)).toBe(true);
    // A multi-byte character cut at the end of the sampled bytes is still text.
    expect(signatureMatches("text/plain", viet.subarray(0, viet.length - 2))).toBe(true);
  });

  it("rejects types that are never accepted", () => {
    expect(signatureMatches("image/svg+xml", bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(false);
    expect(signatureMatches("text/html", bytes("<p>hi</p>"))).toBe(false);
    expect(signatureMatches("application/zip", bytes("PK", 3, 4))).toBe(false);
    expect(signatureMatches("application/x-msdownload", bytes("MZ"))).toBe(false);
  });
});

describe("guessMime", () => {
  it("prefers a known browser type, then the extension", () => {
    expect(guessMime("Lecture.MP4", "")).toBe("video/mp4");
    expect(guessMime("notes.md", "")).toBe("text/markdown");
    expect(guessMime("loop.py", "text/x-python")).toBe("text/plain");
    expect(guessMime("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  it("passes unknown types through so the server can reject them", () => {
    expect(guessMime("setup.exe", "application/x-msdownload")).toBe("application/x-msdownload");
    expect(guessMime("README", "")).toBe("application/octet-stream");
  });
});

describe("formatBytes", () => {
  it("uses binary units with one decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(945_760)).toBe("923.6 KB");
    expect(formatBytes(500 * 1024 * 1024)).toBe("500.0 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });
});
