// Client components import t from here instead of "@/i18n" so their bundle carries only
// the core strings and this area's strings, not every dictionary.
import { core } from "../messages/core";
import { account } from "../messages/account";
import { fill } from "../format";

const dict: Record<string, string> = { ...core, ...account };
export type AccountKey = keyof typeof core | keyof typeof account;

export function t(key: AccountKey, vars?: Record<string, string | number>): string {
  return fill(dict[key] ?? key, vars);
}
