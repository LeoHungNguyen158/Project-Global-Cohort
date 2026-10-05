"use client";
import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { buttonClass } from "./button";

export function SubmitButton({
  children,
  pendingText = "Saving…",
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "secondary" | "danger" | "subtle" | "ghost"; size?: "sm" | "md" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || props.disabled} aria-disabled={pending} className={buttonClass(variant, size, className)} {...props}>
      {pending ? pendingText : children}
    </button>
  );
}
