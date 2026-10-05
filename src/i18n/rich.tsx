import type { ReactNode } from "react";
import { t, type MessageKey } from "./index";
import { richText } from "./rich-text";

/**
 * Translate a sentence whose placeholders are React nodes, such as a link inside the
 * sentence ("Browse the {link} to request access."). Keeping the whole sentence in one
 * string lets a translation move the link to wherever the language needs it.
 */
export function tRich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode {
  return richText(t(key), nodes);
}
