// Client components import t from here instead of "@/i18n" so their bundle carries only
// the core strings and this area's strings, not every dictionary.
import { core } from "../messages/core";
import { grades } from "../messages/grades";
import { fill } from "../format";

const dict: Record<string, string> = { ...core, ...grades };
export type GradesKey = keyof typeof core | keyof typeof grades;

export function t(key: GradesKey, vars?: Record<string, string | number>): string {
  return fill(dict[key] ?? key, vars);
}
