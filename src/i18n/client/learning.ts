// Client components import t from here instead of "@/i18n" so their bundle carries only
// the core strings and this area's strings, not every dictionary.
import { core } from "../messages/core";
import { learning } from "../messages/learning";
import { fill } from "../format";

const dict: Record<string, string> = { ...core, ...learning };
export type LearningKey = keyof typeof core | keyof typeof learning;

export function t(key: LearningKey, vars?: Record<string, string | number>): string {
  return fill(dict[key] ?? key, vars);
}
