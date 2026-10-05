import { foldForSearch, matchesSearch } from "@/components/public/text";

// Time zone choices for the profile. Browsers and Node list zones by their CLDR IDs,
// some of which are old spellings (e.g. "Asia/Saigon"); the app stores current IANA
// names (e.g. "Asia/Ho_Chi_Minh"), so renamed IDs are mapped to their current name.
const RENAMED: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
  GMT: "UTC",
};

// Extra words people search for (country, common names, abbreviations).
const KEYWORDS: Record<string, string> = {
  "America/New_York": "Eastern Time ET EST EDT New York United States USA",
  "America/Chicago": "Central Time CT CST CDT United States USA",
  "America/Denver": "Mountain Time MT MST MDT United States USA",
  "America/Phoenix": "Arizona Mountain Time MST",
  "America/Los_Angeles": "Pacific Time PT PST PDT California United States USA",
  "America/Anchorage": "Alaska AKST AKDT",
  "Pacific/Honolulu": "Hawaii HST",
  "America/Toronto": "Canada Eastern Time",
  "America/Vancouver": "Canada Pacific Time",
  "America/Sao_Paulo": "Brazil",
  "America/Mexico_City": "Mexico",
  "Europe/London": "United Kingdom UK Britain GMT BST",
  "Europe/Dublin": "Ireland",
  "Europe/Berlin": "Germany CET CEST",
  "Europe/Paris": "France CET CEST",
  "Europe/Madrid": "Spain CET CEST",
  "Europe/Rome": "Italy CET CEST",
  "Europe/Amsterdam": "Netherlands CET CEST",
  "Asia/Ho_Chi_Minh": "Vietnam Việt Nam Hanoi Hà Nội Saigon Sài Gòn Ho Chi Minh City Hồ Chí Minh Da Nang Đà Nẵng ICT",
  "Asia/Bangkok": "Thailand ICT",
  "Asia/Jakarta": "Indonesia WIB",
  "Asia/Manila": "Philippines PHT",
  "Asia/Singapore": "Singapore SGT",
  "Asia/Kuala_Lumpur": "Malaysia",
  "Asia/Shanghai": "China CST Beijing",
  "Asia/Hong_Kong": "Hong Kong HKT",
  "Asia/Tokyo": "Japan JST",
  "Asia/Seoul": "Korea KST",
  "Asia/Kolkata": "India IST Mumbai Delhi Calcutta",
  "Asia/Dubai": "United Arab Emirates UAE",
  "Australia/Sydney": "Australia AEST AEDT",
  "Africa/Lagos": "Nigeria WAT",
  "Africa/Nairobi": "Kenya EAT",
  UTC: "Coordinated Universal Time GMT Zulu",
};

export function canonicalTimeZone(tz: string): string {
  return RENAMED[tz] ?? tz;
}

export function isValidTimeZoneId(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Every selectable zone, by current IANA name, sorted alphabetically (UTC included). */
export function listTimeZones(source: readonly string[] = supportedZones()): string[] {
  const set = new Set<string>(["UTC"]);
  for (const tz of source) {
    const canonical = canonicalTimeZone(tz);
    if (isValidTimeZoneId(canonical)) set.add(canonical);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "en"));
}

function supportedZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}

/** Minutes east of UTC for the zone at a given moment (DST-aware). */
export function offsetMinutes(tz: string, at: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  const instant = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((wall - instant) / 60_000);
}

/** "UTC+07:00", "UTC-04:00", "UTC+05:45", "UTC+00:00". */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/** Readable zone name: "Asia/Ho_Chi_Minh" -> "Asia/Ho Chi Minh". */
export function zoneDisplayName(tz: string): string {
  return tz.replaceAll("_", " ");
}

export type TimeZoneOption = { value: string; offset: number };

/** Option label shown in the picker, e.g. "(UTC+07:00) Asia/Ho Chi Minh". */
export function timeZoneLabel(option: TimeZoneOption): string {
  return `(${formatUtcOffset(option.offset)}) ${zoneDisplayName(option.value)}`;
}

/**
 * Builds the picker options with each zone's current offset, ordered by offset then
 * name. A stored value that is valid but not in the list (an older alias) is kept so
 * the current setting is always visible.
 */
export function buildTimeZoneOptions(at: Date = new Date(), current?: string | null, zones: readonly string[] = listTimeZones()): TimeZoneOption[] {
  const values = new Set(zones);
  if (current && !values.has(current) && isValidTimeZoneId(current)) values.add(current);
  return Array.from(values)
    .map((value) => ({ value, offset: offsetMinutes(value, at) }))
    .sort((a, b) => a.offset - b.offset || a.value.localeCompare(b.value, "en"));
}

function offsetSearchTerms(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const short = m ? `${h}:${mm}` : `${h}`;
  return [`UTC${sign}${hh}:${mm}`, `UTC${sign}${short}`, `GMT${sign}${short}`, `${sign}${short}`, `${sign}${hh}`, `${sign}${hh}${mm}`].join(" ");
}

const ALIASES_BY_CANONICAL = Object.entries(RENAMED).reduce<Record<string, string[]>>((acc, [legacy, canonical]) => {
  (acc[canonical] ??= []).push(legacy.replaceAll("_", " "));
  return acc;
}, {});

/** Search text for an option: name, city, former names, offset spellings and keywords. */
export function timeZoneSearchText(option: TimeZoneOption): string {
  const v = option.value;
  return [v, zoneDisplayName(v), ...(ALIASES_BY_CANONICAL[v] ?? []), KEYWORDS[v] ?? "", offsetSearchTerms(option.offset)].join(" ");
}

/** Filters options by a free-text query (accent- and case-insensitive; every term must match). */
export function filterTimeZones(options: TimeZoneOption[], query: string): TimeZoneOption[] {
  if (!foldForSearch(query)) return options;
  return options.filter((o) => matchesSearch(query, [timeZoneSearchText(o)]));
}
