import { Fragment, type ReactNode } from "react";

/** Splits a translated sentence at {name} placeholders and puts React nodes in their place. */
export function richText(text: string, nodes: Record<string, ReactNode>): ReactNode {
  return text
    .split(/(\{[A-Za-z][A-Za-z0-9]*\})/)
    .map((part, i) => {
      const name = /^\{([A-Za-z][A-Za-z0-9]*)\}$/.exec(part)?.[1];
      return <Fragment key={i}>{name !== undefined && name in nodes ? nodes[name] : part}</Fragment>;
    });
}
