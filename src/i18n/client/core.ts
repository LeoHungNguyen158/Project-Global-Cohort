// Client components import t from here instead of "@/i18n" so their bundle carries only
// the core strings and this area's strings, not every dictionary.
import { core } from "../messages/core";
import { fill } from "../format";

export type CoreKey = keyof typeof core;

export function t(key: CoreKey, vars?: Record<string, string | number>): string {
  return fill((core as Record<string, string>)[key] ?? key, vars);
}
