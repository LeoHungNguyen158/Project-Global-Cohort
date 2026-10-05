// Client components import t from here instead of "@/i18n" so their bundle carries only
// the core strings and this area's strings, not every dictionary.
import { core } from "../messages/core";
import { admin } from "../messages/admin";
import { fill } from "../format";

const dict: Record<string, string> = { ...core, ...admin };
export type AdminKey = keyof typeof core | keyof typeof admin;

export function t(key: AdminKey, vars?: Record<string, string | number>): string {
  return fill(dict[key] ?? key, vars);
}
