"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

export type AdminTab = { href: string; label: string };

/** Section navigation for the administration area; the current section follows the URL. */
export function AdminNav({ label, tabs }: { label: string; tabs: AdminTab[] }) {
  const pathname = usePathname() ?? "";
  const current =
    tabs
      .filter((t) => (t.href === "/admin" ? pathname === "/admin" : pathname === t.href || pathname.startsWith(`${t.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  return (
    <nav aria-label={label} className="overflow-x-auto border-t border-line bg-panel px-2 sm:px-6">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={t.href === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium",
                t.href === current ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
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
