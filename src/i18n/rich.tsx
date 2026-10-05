import { Fragment, type ReactNode } from "react";
import { t, type MessageKey } from "./index";

/**
 * Translate a sentence whose placeholders are React nodes, such as a link inside the
 * sentence ("Browse the {link} to request access."). Keeping the whole sentence in one
 * string lets a translation move the link to wherever the language needs it.
 */
export function tRich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode {
  return t(key)
    .split(/(\{[A-Za-z][A-Za-z0-9]*\})/)
    .map((part, i) => {
      const name = /^\{([A-Za-z][A-Za-z0-9]*)\}$/.exec(part)?.[1];
      return <Fragment key={i}>{name !== undefined && name in nodes ? nodes[name] : part}</Fragment>;
    });
}
