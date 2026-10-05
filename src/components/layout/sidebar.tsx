"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity, BookOpen, CalendarDays, CircleUserRound, GraduationCap, LogOut, Mail, Menu, Shield, Users, Wrench, X,
} from "lucide-react";
import { t } from "@/i18n";

const NAV = [
  { href: "/activity", key: "nav.activity", icon: Activity },
  { href: "/courses", key: "nav.courses", icon: BookOpen },
  { href: "/cohorts", key: "nav.cohorts", icon: Users },
  { href: "/calendar", key: "nav.calendar", icon: CalendarDays },
  { href: "/messages", key: "nav.messages", icon: Mail },
  { href: "/grades", key: "nav.grades", icon: GraduationCap },
  { href: "/tools", key: "nav.tools", icon: Wrench },
] as const;

export function Sidebar({
  displayName,
  unreadMessages,
  showAdmin,
  signOutAction,
}: {
  displayName: string;
  unreadMessages: number;
  showAdmin: boolean;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        openRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const linkClass = (active: boolean) =>
    `flex min-h-11 items-center gap-3 border-l-4 px-4 text-[0.95rem] ${
      active ? "border-[#a78bfa] bg-sidebar-active font-semibold text-white" : "border-transparent text-sidebar-text hover:bg-sidebar-hover hover:underline"
    }`;

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-5">
        <Link href="/activity" className="block rounded-sm border border-white/30 px-3 py-2 text-white">
          <span className="block text-lg font-bold leading-tight tracking-wide">{t("app.wordmark")}</span>
          <span className="block text-xs uppercase tracking-[0.2em] text-sidebar-text">{t("app.tagline")}</span>
        </Link>
        <button ref={closeRef} type="button" className="rounded-md p-2 text-white hover:bg-sidebar-hover lg:hidden" onClick={() => { setOpen(false); openRef.current?.focus(); }} aria-label={t("nav.closeMenu")}>
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <nav aria-label={t("nav.primary")} className="flex-1 overflow-y-auto">
        <ul>
          <li className="border-y border-white/10">
            <Link href="/profile" className={linkClass(isActive("/profile"))} aria-current={isActive("/profile") ? "page" : undefined}>
              <CircleUserRound aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="truncate">{displayName}</span>
              <span className="sr-only"> ({t("nav.profile")})</span>
            </Link>
          </li>
          {NAV.map(({ href, key, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className={linkClass(isActive(href))} aria-current={isActive(href) ? "page" : undefined}>
                <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                <span>{t(key)}</span>
                {href === "/messages" && unreadMessages > 0 ? (
                  <span className="ml-auto rounded-full bg-white px-2 text-xs font-semibold text-sidebar">
                    {unreadMessages}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
          {showAdmin ? (
            <li className="mt-2 border-t border-white/10">
              <Link href="/admin" className={linkClass(isActive("/admin"))} aria-current={isActive("/admin") ? "page" : undefined}>
                <Shield aria-hidden="true" className="h-5 w-5 shrink-0" />
                <span>{t("nav.admin")}</span>
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>
      <div className="border-t border-white/10 pb-3">
        <form action={signOutAction}>
          <button type="submit" className="flex min-h-11 w-full items-center gap-3 px-5 text-left text-sidebar-text hover:bg-sidebar-hover hover:underline">
            <LogOut aria-hidden="true" className="h-5 w-5" />
            {t("nav.signOut")}
          </button>
        </form>
        <p className="px-4 pt-2 text-xs text-sidebar-text">
          <Link className="hover:underline" href="/privacy">{t("nav.privacy")}</Link>
          {" • "}
          <Link className="hover:underline" href="/terms">{t("nav.terms")}</Link>
          {" • "}
          <Link className="hover:underline" href="/accessibility">{t("nav.accessibility")}</Link>
        </p>
      </div>
    </div>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center gap-3 bg-sidebar px-3 py-2 text-white lg:hidden">
        <button ref={openRef} type="button" onClick={() => setOpen(true)} className="rounded-md p-2 hover:bg-sidebar-hover" aria-label={t("nav.openMenu")} aria-expanded={open} aria-controls="mobile-nav">
          <Menu aria-hidden="true" className="h-6 w-6" />
        </button>
        <span className="font-semibold">{t("app.name")}</span>
      </div>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] bg-sidebar lg:block">{content}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label={t("nav.closeMenu")} tabIndex={-1} className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside id="mobile-nav" role="dialog" aria-modal="true" aria-label={t("nav.primary")} className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-sidebar">
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}
