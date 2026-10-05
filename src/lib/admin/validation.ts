// Field validation for administration forms. Pure functions (unit tested); the
// database constraints and RPCs check the same rules again.
import { isValidTimeZone, wallTimeToUtcIso } from "@/lib/time";

/** Codes for cohorts, courses and offerings (matches the database check). */
export const CODE_PATTERN = /^[A-Za-z0-9_.-]{2,64}$/;

export function isValidCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

/** A real calendar date written as YYYY-MM-DD. */
export function isDateOnly(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

export type FieldErrors = Record<string, string>;

export type CohortInput = {
  code: string;
  name: string;
  description: string;
  timezone: string;
  startsOn: string | null;
  endsOn: string | null;
  status: string;
};

/** Error keys (dictionary suffixes) per field; empty when valid. */
export function validateCohort(input: CohortInput): FieldErrors {
  const errors: FieldErrors = {};
  if (!isValidCode(input.code)) errors.code = "code";
  if (input.name.length < 1 || input.name.length > 200) errors.name = "name";
  if (input.description.length > 2000) errors.description = "description";
  if (!isValidTimeZone(input.timezone) || input.timezone.length > 64) errors.timezone = "timezone";
  if (input.startsOn && !isDateOnly(input.startsOn)) errors.startsOn = "date";
  if (input.endsOn && !isDateOnly(input.endsOn)) errors.endsOn = "date";
  if (!errors.startsOn && !errors.endsOn && input.startsOn && input.endsOn && input.endsOn < input.startsOn) errors.endsOn = "dateOrder";
  if (!["upcoming", "active", "archived"].includes(input.status)) errors.status = "status";
  return errors;
}

export type CommunityInput = {
  name: string;
  description: string;
  cohortId: string | null;
  joinPolicy: string;
};

/** Error keys (dictionary suffixes) per field; empty when valid. */
export function validateCommunity(input: CommunityInput): FieldErrors {
  const errors: FieldErrors = {};
  if (input.name.length < 1 || input.name.length > 200) errors.name = "name";
  if (input.description.length > 2000) errors.description = "description";
  if (!["open", "invite"].includes(input.joinPolicy)) errors.join_policy = "joinPolicy";
  return errors;
}

export type OfferingInput = {
  code: string;
  termLabel: string;
  startsLocal: string;
  endsLocal: string;
  timezone: string;
  status: string;
  accentColor: string;
  catalogState: string;
};

export type OfferingTimes = { startsAt: string | null; endsAt: string | null };

/**
 * Validates an offering form. Start and end are wall-clock times in the offering's
 * own time zone (what the administrator sees on the course schedule), stored as UTC.
 */
export function validateOffering(input: OfferingInput): { errors: FieldErrors; times: OfferingTimes } {
  const errors: FieldErrors = {};
  if (!isValidCode(input.code)) errors.code = "code";
  if (input.termLabel.length > 100) errors.termLabel = "termLabel";
  const tzOk = isValidTimeZone(input.timezone) && input.timezone.length <= 64;
  if (!tzOk) errors.timezone = "timezone";
  let startsAt: string | null = null;
  let endsAt: string | null = null;
  if (tzOk) {
    if (input.startsLocal) {
      startsAt = wallTimeToUtcIso(input.startsLocal, input.timezone);
      if (!startsAt) errors.startsAt = "dateTime";
    }
    if (input.endsLocal) {
      endsAt = wallTimeToUtcIso(input.endsLocal, input.timezone);
      if (!endsAt) errors.endsAt = "dateTime";
    }
    if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = "dateTimeOrder";
  }
  if (!["draft", "published", "archived"].includes(input.status)) errors.status = "status";
  if (!isHexColor(input.accentColor)) errors.accentColor = "color";
  if (!["open_for_requests", "not_open"].includes(input.catalogState)) errors.catalogState = "status";
  return { errors, times: { startsAt, endsAt } };
}

/** Megabytes typed by an administrator → bytes (up to two decimals). */
export function megabytesToBytes(value: string): number | null {
  const v = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const bytes = Math.round(Number(v) * 1024 * 1024);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

export function bytesToMegabytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Converts an inclusive date range typed in the viewer's time zone into UTC bounds:
 * [start of `from`, start of the day after `to`).
 */
export function dayRangeToUtc(from: string, to: string, tz: string): { from: string | null; to: string | null } {
  const start = isDateOnly(from) ? wallTimeToUtcIso(`${from}T00:00`, tz) : null;
  let end: string | null = null;
  if (isDateOnly(to)) {
    const [y, m, d] = to.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const iso = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
    end = wallTimeToUtcIso(`${iso}T00:00`, tz);
  }
  return { from: start, to: end };
}

/** Invitation expiry choices offered in forms (days). */
export const EXPIRY_DAYS = [3, 7, 14, 30, 60, 90] as const;

export function expiryFromDays(days: number, now = new Date()): string | null {
  if (!(EXPIRY_DAYS as readonly number[]).includes(days)) return null;
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** Every IANA zone the runtime knows, common ones first. */
export function timeZoneOptions(common: string[]): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return Array.from(new Set([...common, ...all]));
}
