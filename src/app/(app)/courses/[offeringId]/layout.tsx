import Link from "next/link";
import type { Metadata } from "next";
import { CourseTabs } from "@/components/course/course-tabs";
import { Badge } from "@/components/ui/badge";
import { requireOffering, type OfferingAccess } from "@/lib/data/offering-access";
import { offeringTitle } from "@/lib/data/offerings";
import { formatDate } from "@/lib/time";

export async function generateMetadata({ params }: { params: Promise<{ offeringId: string }> }): Promise<Metadata> {
  const { offeringId } = await params;
  const { offering } = await requireOffering(offeringId);
  return { title: offeringTitle(offering) };
}

function RoleBadge({ access }: { access: OfferingAccess }) {
  if (access.staff?.role === "instructor") return <Badge tone="info">Instructor</Badge>;
  if (access.staff?.role === "ta") return <Badge tone="info">Teaching assistant</Badge>;
  if (access.isOfferingAdmin) return <Badge tone="info">Administrator view</Badge>;
  if (access.enrollmentStatus === "completed") return <Badge tone="success">Completed</Badge>;
  return <Badge>Enrolled</Badge>;
}

export default async function CourseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  const { offering, user } = access;
  const tz = user.timezone;
  return (
    <div>
      <header className="border-b border-line bg-panel">
        <div aria-hidden="true" className="h-1.5" style={{ backgroundColor: offering.accent_color }} />
        <div className="px-4 pb-3 pt-4 sm:px-8">
          <nav aria-label="Breadcrumb" className="mb-1 text-sm text-muted">
            <Link href="/courses" className="underline-offset-2 hover:underline">Courses</Link>
            <span aria-hidden="true"> / </span>
            <span>{offering.code}</span>
          </nav>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted">{offering.code}{offering.courses?.code ? ` · ${offering.courses.code}` : ""}</p>
              <h1 className="text-[1.75rem] leading-tight [font-family:Georgia,'Times_New_Roman',serif]">{offeringTitle(offering)}</h1>
              <p className="mt-1 text-sm text-muted">
                {offering.cohorts?.name}
                {offering.term_label ? ` · ${offering.term_label}` : ""}
                {offering.starts_at ? ` · ${formatDate(offering.starts_at, tz)} – ${formatDate(offering.ends_at, tz)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RoleBadge access={access} />
              {offering.status === "archived" ? <Badge tone="warning">Archived · read-only</Badge> : null}
              {offering.status === "draft" ? <Badge tone="warning">Not yet visible to learners</Badge> : null}
              {offering.is_sample ? <Badge>Sample data</Badge> : null}
            </div>
          </div>
        </div>
        <CourseTabs offeringId={offering.id} />
      </header>
      {children}
    </div>
  );
}
