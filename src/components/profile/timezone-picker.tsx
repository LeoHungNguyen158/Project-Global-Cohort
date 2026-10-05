"use client";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { Select } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { canonicalTimeZone, filterTimeZones, timeZoneLabel, zoneDisplayName, type TimeZoneOption } from "./timezones";
import { t } from "@/i18n/client/account";

const noop = () => () => {};
const deviceZone = () => {
  try {
    return canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
};
// The current minute, refreshed every 30 seconds (client only; null while server rendering).
const subscribeMinute = (cb: () => void) => {
  const id = window.setInterval(cb, 30_000);
  return () => window.clearInterval(id);
};
const currentMinute = () => Math.floor(Date.now() / 60_000);

/**
 * Searchable time zone selector: a filter box narrows a native <select> whose options
 * show each zone's current UTC offset. The select is the form field, so it works with
 * the keyboard, screen readers and without scripts (all zones are listed).
 */
export function TimeZonePicker({ id, name, defaultValue, options }: { id: string; name: string; defaultValue: string; options: TimeZoneOption[] }) {
  const searchId = useId();
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState("");
  const detected = useSyncExternalStore(noop, deviceZone, () => null);
  const minute = useSyncExternalStore(subscribeMinute, currentMinute, () => null);

  const matches = useMemo(() => filterTimeZones(options, query), [options, query]);
  const selected = options.find((o) => o.value === value) ?? null;
  // The current selection always stays in the list, so filtering never changes it.
  const shown = selected && !matches.some((o) => o.value === value) ? [selected, ...matches] : matches;
  const filtering = query.trim().length > 0;
  const countText = !filtering
    ? ""
    : matches.length === 0
      ? t("profile.timezoneNoMatches")
      : matches.length === 1
        ? t("profile.timezoneMatchesOne")
        : t("profile.timezoneMatches", { count: matches.length });

  const localTime =
    minute !== null && value
      ? new Intl.DateTimeFormat("en-US", { timeZone: value, hour: "numeric", minute: "2-digit", weekday: "short" }).format(new Date(minute * 60_000))
      : null;
  const detectedOption = detected ? options.find((o) => o.value === detected) ?? null : null;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label htmlFor={searchId} className="block text-sm text-ink">{t("profile.timezoneSearch")}</label>
        <p id={`${searchId}-hint`} className="text-xs text-muted">{t("profile.timezoneSearchHint")}</p>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter in the filter box should not submit the whole profile form.
            if (e.key === "Enter") e.preventDefault();
          }}
          aria-controls={id}
          aria-describedby={`${searchId}-hint ${searchId}-count`}
          autoComplete="off"
          className="block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink"
        />
        <p id={`${searchId}-count`} aria-live="polite" className="min-h-4 text-xs text-muted">{countText}</p>
      </div>
      <Select id={id} name={name} value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={`${id}-hint`}>
        {shown.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === value && filtering && !matches.some((m) => m.value === value)
              ? t("profile.timezoneCurrent", { label: timeZoneLabel(o) })
              : timeZoneLabel(o)}
          </option>
        ))}
      </Select>
      {localTime ? <p className="text-sm text-muted">{t("profile.timezoneLocalTime", { time: localTime })}</p> : null}
      {detected ? (
        detectedOption && detectedOption.value !== value ? (
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            onClick={() => {
              setValue(detectedOption.value);
              setQuery("");
            }}
          >
            {t("profile.timezoneDetect")} ({zoneDisplayName(detectedOption.value)})
          </button>
        ) : !detectedOption ? (
          <p className="text-xs text-muted">{t("profile.timezoneDetectUnavailable")}</p>
        ) : null
      ) : null}
    </div>
  );
}
