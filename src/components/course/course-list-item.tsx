import Link from "next/link";
import { Lock, MoreHorizontal } from "lucide-react";
import { Disclosure } from "@/components/ui/disclosure";
import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "./favorite-button";
import type { OfferingSummary, StaffRow } from "@/lib/data/offerings";
import { offeringPhase, offeringTitle } from "@/lib/data/offerings";
import { formatDate } from "@/lib/time";

export type CourseListEntry = {
  offering: OfferingSummary;
  staff: StaffRow[];
  favorite: boolean;
  role: "instructor" | "ta" | "learner" | "admin";
  enrollmentStatus: string | null;
  progressPercent: number | null;
};

function StatusText({ entry }: { entry: CourseListEntry }) {
  const o = entry.offering;
  if (o.status === "draft") return <span>Draft (hidden from learners)</span>;
  const phase = offeringPhase(o);
  if (phase === "archived")
    return (
      <span className="inline-flex items-center gap-1">
        <Lock aria-hidden="true" className="h-3.5 w-3.5" /> Closed
      </span>
    );
  if (phase === "upcoming") return <span>Opens {formatDate(o.starts_at, o.timezone)}</span>;
  return <span>Open</span>;
}

function Instructors({ staff }: { staff: StaffRow[] }) {
  const instructors = staff.filter((s) => s.role === "instructor");
  const people = instructors.length > 0 ? instructors : staff;
  if (people.length === 0) return <span className="text-muted">No instructor listed</span>;
  if (staff.length === 1) return <span>{staff[0].profiles?.display_name ?? "Instructor"}</span>;
  return (
    <details className="relative inline-block">
      <summary className="cursor-pointer list-none text-primary underline underline-offset-2 [&::-webkit-details-marker]:hidden">
        Multiple Instructors
      </summary>
      <div className="absolute left-0 z-10 mt-1 w-64 rounded-md border border-line bg-panel p-3 shadow-lg">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Course staff</p>
        <ul className="space-y-1 text-sm">
          {staff.map((s) => (
            <li key={s.user_id}>
              {s.profiles?.display_name ?? "Staff member"} <span className="text-muted">({s.role === "ta" ? "Teaching assistant" : "Instructor"})</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function RoleLabel({ entry }: { entry: CourseListEntry }) {
  switch (entry.role) {
    case "instructor":
      return <>You teach this course</>;
    case "ta":
      return <>You are a teaching assistant</>;
    case "admin":
      return <>You administer this offering</>;
    default:
      return <>{entry.enrollmentStatus === "completed" ? "Completed" : "Enrolled"}</>;
  }
}

function MoreInfo({ entry, tz }: { entry: CourseListEntry; tz: string }) {
  const o = entry.offering;
  return (
    <Disclosure summary="More info" summaryClassName="text-ink">
      <dl className="grid max-w-2xl grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md bg-canvas p-3 text-sm">
        {o.course_versions?.summary ? (
          <>
            <dt className="font-medium">Summary</dt>
            <dd>{o.course_versions.summary}</dd>
          </>
        ) : null}
        <dt className="font-medium">Cohort</dt>
        <dd>{o.cohorts?.name ?? "—"}</dd>
        <dt className="font-medium">Term</dt>
        <dd>{o.term_label || "—"}</dd>
        <dt className="font-medium">Dates</dt>
        <dd>
          {o.starts_at ? `${formatDate(o.starts_at, tz)} – ${formatDate(o.ends_at, tz)}` : "Not scheduled"}
          {o.timezone !== tz ? <span className="text-muted"> (course time zone: {o.timezone})</span> : null}
        </dd>
        <dt className="font-medium">Your role</dt>
        <dd><RoleLabel entry={entry} /></dd>
        {entry.progressPercent !== null ? (
          <>
            <dt className="font-medium">Progress</dt>
            <dd>{entry.progressPercent}% of required items complete</dd>
          </>
        ) : null}
      </dl>
    </Disclosure>
  );
}

function CourseMenu({ entry }: { entry: CourseListEntry }) {
  const id = entry.offering.id;
  const title = offeringTitle(entry.offering);
  return (
    <details className="relative">
      <summary
        className="inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md hover:bg-canvas [&::-webkit-details-marker]:hidden"
        aria-label={`Course options for ${title}`}
      >
        <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
      </summary>
      <ul className="absolute right-0 z-10 mt-1 w-52 rounded-md border border-line bg-panel py-1 text-sm shadow-lg">
        <li><Link className="block px-3 py-2 hover:bg-canvas" href={`/courses/${id}`}>Open course</Link></li>
        <li><Link className="block px-3 py-2 hover:bg-canvas" href={`/courses/${id}/content`}>Course content</Link></li>
        <li><Link className="block px-3 py-2 hover:bg-canvas" href={`/courses/${id}/grades`}>Grades</Link></li>
        <li><Link className="block px-3 py-2 hover:bg-canvas" href={`/messages?offering=${id}`}>Messages</Link></li>
        <li><Link className="block px-3 py-2 hover:bg-canvas" href={`/courses/${id}/calendar`}>Calendar</Link></li>
      </ul>
    </details>
  );
}

export function CourseRow({ entry, tz }: { entry: CourseListEntry; tz: string }) {
  const o = entry.offering;
  const title = offeringTitle(o);
  return (
    <li className="flex rounded-[var(--radius-panel)] border border-line bg-panel">
      <span aria-hidden="true" className="w-2 shrink-0 rounded-l-[var(--radius-panel)]" style={{ backgroundColor: o.accent_color }} />
      <div className="flex min-w-0 flex-1 items-start gap-2 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">{o.code}</p>
          <h3 className="font-semibold">
            <Link href={`/courses/${o.id}`} className="hover:underline">{title}</Link>
          </h3>
          <div className="mt-1 flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
            <StatusText entry={entry} />
            <span aria-hidden="true">|</span>
            <Instructors staff={entry.staff} />
            <span aria-hidden="true">|</span>
            <MoreInfo entry={entry} tz={tz} />
          </div>
          {entry.offering.is_sample ? <Badge className="mt-2">Sample data</Badge> : null}
        </div>
        <FavoriteButton offeringId={o.id} title={title} favorite={entry.favorite} />
        <CourseMenu entry={entry} />
      </div>
    </li>
  );
}

export function CourseCard({ entry }: { entry: CourseListEntry }) {
  const o = entry.offering;
  const title = offeringTitle(o);
  return (
    <li className="flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
      <div
        aria-hidden="true"
        className="h-24"
        style={{ background: `linear-gradient(135deg, ${o.accent_color} 0%, ${o.accent_color}cc 45%, #0f172a 100%)` }}
      />
      <div className="flex flex-1 flex-col px-4 py-3">
        <p className="text-sm text-muted">{o.code}</p>
        <h3 className="font-semibold leading-snug">
          <Link href={`/courses/${o.id}`} className="hover:underline">{title}</Link>
        </h3>
        <div className="mt-1 flex flex-wrap gap-x-2 text-sm">
          <StatusText entry={entry} />
          <span aria-hidden="true">|</span>
          <Instructors staff={entry.staff} />
        </div>
        {entry.progressPercent !== null ? (
          <div className="mt-2 text-sm">
            <span className="sr-only">Progress: </span>
            <progress max={100} value={entry.progressPercent} className="h-2 w-full" aria-label={`Progress ${entry.progressPercent}%`} />
            <span className="text-muted">{entry.progressPercent}% complete</span>
          </div>
        ) : null}
        <div className="mt-auto flex items-center justify-end pt-2">
          <FavoriteButton offeringId={o.id} title={title} favorite={entry.favorite} />
          <CourseMenu entry={entry} />
        </div>
      </div>
    </li>
  );
}
