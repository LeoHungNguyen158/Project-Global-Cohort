import { describe, expect, it } from "vitest";
import { buildIcs, icsDateTime, icsEscapeText, icsFileName, icsFoldLine } from "@/lib/calendar/ics";
import { wallTimeToUtcIso } from "@/lib/time";

const octets = (s: string) => new TextEncoder().encode(s).length;
const unfold = (s: string) => s.replace(/\r\n /g, "");

describe(".ics text", () => {
  it("escapes TEXT values per RFC 5545", () => {
    expect(icsEscapeText("a, b; c\\d")).toBe("a\\, b\\; c\\\\d");
    expect(icsEscapeText("line 1\r\nline 2\nline 3")).toBe("line 1\\nline 2\\nline 3");
    expect(icsEscapeText("bell\u0007 ok")).toBe("bell ok");
  });

  it("folds long lines at 75 octets without splitting UTF-8 characters", () => {
    const line = `SUMMARY:${"Buổi học trực tiếp về tác tử AI — ".repeat(5)}`;
    const folded = icsFoldLine(line);
    for (const physical of folded.split("\r\n")) expect(octets(physical)).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(unfold(folded)).toBe(line);
    expect(icsFoldLine("SHORT:ok")).toBe("SHORT:ok");
  });

  it("writes UTC date-times", () => {
    expect(icsDateTime("2026-11-02T14:00:00.000Z")).toBe("20261102T140000Z");
    expect(icsDateTime("2026-10-08T13:00:00+00:00")).toBe("20261008T130000Z");
    expect(() => icsDateTime("not a date")).toThrow();
  });

  it("makes safe file names", () => {
    expect(icsFileName("Giờ hỗ trợ: Đặng / Q&A")).toBe("gio-ho-tro-dang-q-a.ics");
    expect(icsFileName("***")).toBe("event.ics");
  });
});

describe(".ics documents", () => {
  // 9:00 AM New York on Nov 2, 2026 is after the DST change: EST, UTC-5.
  const start = wallTimeToUtcIso("2026-11-02T09:00", "America/New_York")!;
  const end = wallTimeToUtcIso("2026-11-02T10:00", "America/New_York")!;

  it("builds one VEVENT with correct UTC times, UID, status and sequence", () => {
    const ics = buildIcs({
      uid: "event-6ea96d64-bcae-4e4c-a6d6-74d95730b310@crew-scaler-lms",
      start,
      end,
      summary: "Live session: tools, memory; planning",
      description: "Bring questions.\nJoin (external link): https://meet.example.com/x",
      location: "Online",
      url: "http://localhost:3000/courses/o1/calendar",
      sequence: 3,
      stamp: "2026-10-05T02:00:00.000Z",
    });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => octets(l) <= 75)).toBe(true);
    const text = unfold(ics);
    expect(text).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(text).toContain("UID:event-6ea96d64-bcae-4e4c-a6d6-74d95730b310@crew-scaler-lms\r\n");
    expect(text).toContain("DTSTAMP:20261005T020000Z\r\n");
    expect(text).toContain("DTSTART:20261102T140000Z\r\n");
    expect(text).toContain("DTEND:20261102T150000Z\r\n");
    expect(text).toContain("SUMMARY:Live session: tools\\, memory\\; planning\r\n");
    expect(text).toContain("DESCRIPTION:Bring questions.\\nJoin (external link): https://meet.example.com/x\r\n");
    expect(text).toContain("URL:http://localhost:3000/courses/o1/calendar\r\n");
    expect(text).toContain("STATUS:CONFIRMED\r\nSEQUENCE:3\r\n");
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("writes deadlines as a point in time and cancelled events as CANCELLED", () => {
    const ics = buildIcs({ uid: "assignment-x@crew-scaler-lms", start, summary: "Due: Project", status: "CANCELLED", url: "javascript:alert(1)" });
    expect(ics).not.toContain("DTEND");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).not.toContain("javascript");
  });

  it("strips unsafe characters from the UID", () => {
    expect(buildIcs({ uid: "a b\r\nX-INJECT:1", start, summary: "x" })).toContain("UID:abX-INJECT1\r\n");
  });
});
