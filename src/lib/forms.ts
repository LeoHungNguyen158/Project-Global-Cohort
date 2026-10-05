import { wallTimeToUtcIso, isValidTimeZone } from "./time";

// Small, explicit readers for FormData. Server actions validate every field again;
// nothing from the client (hidden fields included) is trusted for authorization.

export function str(fd: FormData, name: string, max = 10_000): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function optStr(fd: FormData, name: string, max = 10_000): string | null {
  const v = str(fd, name, max);
  return v === "" ? null : v;
}

export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}

export function num(fd: FormData, name: string): number | null {
  const v = str(fd, name, 64);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function int(fd: FormData, name: string): number | null {
  const n = num(fd, name);
  return n === null || !Number.isInteger(n) ? null : n;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function uuid(fd: FormData, name: string): string | null {
  const v = str(fd, name, 64);
  return isUuid(v) ? v : null;
}

export function uuids(fd: FormData, name: string): string[] {
  return fd.getAll(name).filter((v): v is string => isUuid(v));
}

/**
 * Reads a <DateTimeField>: a datetime-local wall time plus the zone it was entered in
 * (`<name>__tz`). Returns a UTC ISO string, null when empty, or "invalid".
 */
export function dateTime(fd: FormData, name: string): string | null | "invalid" {
  const local = str(fd, name, 32);
  if (!local) return null;
  const tz = str(fd, `${name}__tz`, 64) || "UTC";
  if (!isValidTimeZone(tz)) return "invalid";
  return wallTimeToUtcIso(local, tz) ?? "invalid";
}

export function isHttpsUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && Boolean(u.hostname);
  } catch {
    return false;
  }
}
