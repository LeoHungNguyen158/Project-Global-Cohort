import Link from "next/link";
import { cn } from "./cn";

export function TabNav({ label, tabs, current }: { label: string; tabs: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav aria-label={label} className="overflow-x-auto border-b border-line bg-panel px-2 sm:px-6">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium",
                t.key === current ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
