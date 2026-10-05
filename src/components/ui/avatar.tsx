import { cn } from "./cn";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** Initials avatar (decorative; the name is always shown as text next to it). */
export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className={cn("shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-[#e2e8f0] text-xs font-semibold text-ink", className)}
    >
      {initials(name)}
    </span>
  );
}
