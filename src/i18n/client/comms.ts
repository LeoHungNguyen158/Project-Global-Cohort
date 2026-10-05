// Client components import t from here instead of "@/i18n" so their bundle carries only
// the core strings and this area's strings, not every dictionary.
import { core } from "../messages/core";
import { comms } from "../messages/comms";
import { fill } from "../format";

const dict: Record<string, string> = { ...core, ...comms };
export type CommsKey = keyof typeof core | keyof typeof comms;

export function t(key: CommsKey, vars?: Record<string, string | number>): string {
  return fill(dict[key] ?? key, vars);
}
