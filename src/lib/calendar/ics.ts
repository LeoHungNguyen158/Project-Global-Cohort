// Minimal RFC 5545 (iCalendar) writer for single-event downloads. Times are written in
// UTC ("Z" form) so every calendar application places them at the same instant; text is
// escaped and lines are folded at 75 octets without splitting UTF-8 characters.

export type IcsEvent = {
  uid: string;
  /** ISO instant. */
  start: string;
  /** ISO instant; omit for a deadline (a point in time). */
  end?: string | null;
  summary: string;
  description?: string;
  location?: string;
  /** Absolute http(s) URL back to the item. */
  url?: string | null;
  status?: "CONFIRMED" | "CANCELLED";
  sequence?: number;
  /** ISO instant the file was generated (defaults to now). */
  stamp?: string;
  lastModified?: string | null;
};

export const ICS_PRODID = "-//Crew Scaler//Global Cohort LMS//EN";

/** 2026-11-02T14:00:00.000Z -> 20261102T140000Z */
export function icsDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks; drops other control characters. */
export function icsEscapeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Folds a content line so no physical line exceeds 75 octets (excluding CRLF).
 * Continuation lines start with one space, which counts toward their 75 octets.
 */
export function icsFoldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  let limit = 75;
  for (const ch of line) {
    const len = utf8Length(ch.codePointAt(0)!);
    if (octets + len > limit) {
      out.push(current);
      current = " ";
      octets = 1;
      limit = 75;
    }
    current += ch;
    octets += len;
  }
  out.push(current);
  return out.join("\r\n");
}

function safeUri(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString().replace(/[\r\n]/g, "");
  } catch {
    return null;
  }
}

/** A complete VCALENDAR with one VEVENT, CRLF line endings. */
export function buildIcs(event: IcsEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid.replace(/[^A-Za-z0-9@._-]/g, "")}`,
    `DTSTAMP:${icsDateTime(event.stamp ?? new Date().toISOString())}`,
    `DTSTART:${icsDateTime(event.start)}`,
  ];
  if (event.end) lines.push(`DTEND:${icsDateTime(event.end)}`);
  lines.push(`SUMMARY:${icsEscapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${icsEscapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${icsEscapeText(event.location)}`);
  const url = safeUri(event.url);
  if (url) lines.push(`URL:${url}`);
  lines.push(`STATUS:${event.status ?? "CONFIRMED"}`);
  lines.push(`SEQUENCE:${Math.max(0, Math.floor(event.sequence ?? 0))}`);
  if (event.lastModified) lines.push(`LAST-MODIFIED:${icsDateTime(event.lastModified)}`);
  lines.push("TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR");
  return lines.map(icsFoldLine).join("\r\n") + "\r\n";
}

/** A short, safe download file name: letters, digits and dashes. */
export function icsFileName(title: string, fallback = "event"): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || fallback}.ics`;
}
