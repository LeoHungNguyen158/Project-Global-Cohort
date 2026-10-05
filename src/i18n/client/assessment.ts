// Client components import t from here instead of "@/i18n" so their bundle carries only
// the core strings and this area's strings, not every dictionary.
import { core } from "../messages/core";
import { assessment } from "../messages/assessment";
import { fill } from "../format";

const dict: Record<string, string> = { ...core, ...assessment };
export type AssessmentKey = keyof typeof core | keyof typeof assessment;

export function t(key: AssessmentKey, vars?: Record<string, string | number>): string {
  return fill(dict[key] ?? key, vars);
}
