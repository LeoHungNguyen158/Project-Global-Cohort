import { en, type MessageKey } from "./en";

const dictionaries = { en } as const;
export type Locale = keyof typeof dictionaries;

/** Translate an interface string. Falls back to English for locales without a dictionary yet. */
export function t(key: MessageKey, vars?: Record<string, string | number>, locale: Locale = "en"): string {
  const dict = (dictionaries[locale] ?? en) as Record<string, string>;
  let s = dict[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export type { MessageKey };
