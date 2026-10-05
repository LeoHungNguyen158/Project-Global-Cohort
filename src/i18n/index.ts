import { en, type MessageKey } from "./en";
import { fill } from "./format";

const dictionaries = { en } as const;
export type Locale = keyof typeof dictionaries;

/** Translate an interface string. Falls back to English for locales without a dictionary yet. */
export function t(key: MessageKey, vars?: Record<string, string | number>, locale: Locale = "en"): string {
  const dict = (dictionaries[locale] ?? en) as Record<string, string>;
  return fill(dict[key] ?? en[key] ?? key, vars);
}

export type { MessageKey };
