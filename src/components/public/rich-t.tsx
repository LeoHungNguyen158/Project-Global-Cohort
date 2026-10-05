import { Fragment, type ReactNode } from "react";
import { t, type MessageKey } from "@/i18n";
import { splitTemplate } from "./text";

/**
 * Like t(), but `{name}` placeholders may be filled with React nodes such as links.
 * The whole sentence stays one dictionary entry, so translators can reorder it.
 */
export function tx(key: MessageKey, nodes: Record<string, ReactNode>, vars?: Record<string, string | number>): ReactNode {
  const parts = splitTemplate(t(key, vars));
  return parts.map((part, i) =>
    part.kind === "text" ? (
      <Fragment key={i}>{part.value}</Fragment>
    ) : (
      <Fragment key={i}>{part.name in nodes ? nodes[part.name] : `{${part.name}}`}</Fragment>
    ),
  );
}
