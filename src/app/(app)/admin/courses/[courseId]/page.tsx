import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { isUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { duplicateCourse, renameCourse, setCourseArchived } from "@/app/actions/admin/courses";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { OfferingStatusBadge, SectionTitle } from "@/components/admin/badges";
import { ResultConfirm } from "@/components/admin/result-form";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.course.title") };

type Version = { id: string; version_no: number; status: string; title: string; published_at: string | null; created_at: string };
type Offering = { id: string; code: string; term_label: string; status: string; course_version_id: string; cohorts: { name: string } | null };

const VERSION_TONE = { draft: "warning", published: "success", archived: "neutral" } as const;

export default async function AdminCoursePage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams: Promise<{ created?: string; duplicated?: string }> }) {
  const { courseId } = await params;
  const sp = await searchParams;
  const ctx = await requirePlatformAdmin(`/admin/courses/${courseId}`);
  if (!isUuid(courseId)) notFound();
  const tz = ctx.user.timezone;
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, code, title, is_sample, archived_at, created_at, course_versions(id, version_no, status, title, published_at, created_at), course_offerings(id, code, term_label, status, course_version_id, cohorts(name))")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) notFound();
  const versions = ((course.course_versions ?? []) as Version[]).sort((a, b) => b.version_no - a.version_no);
  const offerings = ((course.course_offerings ?? []) as unknown as Offering[]).sort((a, b) => a.code.localeCompare(b.code));
  const versionNo = new Map(versions.map((v) => [v.id, v.version_no]));
  const archived = Boolean(course.archived_at);
  const authorOffering = offerings.find((o) => o.status !== "archived") ?? null;

  return (
    <PageBody className="space-y-6">
      <SectionTitle
        back={{ href: "/admin/courses", label: t("admin.course.back") }}
        title={course.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{course.code}</span>
            {archived ? <Badge>{t("admin.courses.archivedBadge")}</Badge> : <Badge tone="success">{t("admin.courses.activeBadge")}</Badge>}
            {course.is_sample ? <Badge>{t("admin.common.sample")}</Badge> : null}
          </span>
        }
        actions={
          <ResultConfirm
            action={setCourseArchived}
            fields={{ course: course.id, archive: archived ? "0" : "1" }}
            trigger={archived ? t("admin.course.restore") : t("admin.course.archive")}
            size="md"
            tone={archived ? "primary" : "danger"}
            title={archived ? t("admin.course.restoreTitle", { title: course.title }) : t("admin.course.archiveTitle", { title: course.title })}
            description={archived ? t("admin.course.restoreDescription") : t("admin.course.archiveDescription")}
            confirmLabel={archived ? t("admin.course.restore") : t("admin.course.archive")}
          />
        }
      />
      {sp.created === "1" ? <Alert tone="success">{t("admin.course.created")}</Alert> : null}
      {sp.duplicated === "1" ? <Alert tone="success">{t("admin.course.duplicated")}</Alert> : null}

      <Panel aria-labelledby="course-content">
        <PanelHeader id="course-content" title={t("admin.course.content")} />
        <div className="space-y-3 p-4 sm:px-6">
          <p className="text-sm">{t("admin.course.contentHelp")}</p>
          {authorOffering ? (
            <ButtonLink href={`/courses/${authorOffering.id}/content/manage`} variant="secondary">
              {t("admin.course.editContent", { offering: authorOffering.code })}
            </ButtonLink>
          ) : (
            <p className="text-sm text-muted">
              {archived ? t("admin.course.noAuthorOfferingArchived") : t("admin.course.noAuthorOffering")}
            </p>
          )}
          {!archived ? (
            <ButtonLink href={`/admin/offerings/new?course=${course.id}`} variant="secondary">{t("admin.course.newOffering")}</ButtonLink>
          ) : null}
        </div>
      </Panel>

      <section aria-labelledby="course-versions" className="space-y-3">
        <h3 id="course-versions" className="text-lg font-semibold">{t("admin.course.versions")}</h3>
        <Table caption={t("admin.course.versions")} captionHidden>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("admin.course.version")}</th>
              <th scope="col" className={th}>{t("admin.courses.courseTitle")}</th>
              <th scope="col" className={th}>{t("admin.common.status")}</th>
              <th scope="col" className={th}>{t("admin.course.publishedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td className={`${td} tabular-nums`}>v{v.version_no}</td>
                <td className={td}>{v.title}</td>
                <td className={td}>
                  <Badge tone={VERSION_TONE[v.status as keyof typeof VERSION_TONE] ?? "neutral"}>{t(`admin.versionStatus.${(v.status in VERSION_TONE ? v.status : "draft") as "draft" | "published" | "archived"}`)}</Badge>
                </td>
                <td className={`${td} whitespace-nowrap`}>{v.published_at ? formatDate(v.published_at, tz) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="course-offerings" className="space-y-3">
        <h3 id="course-offerings" className="text-lg font-semibold">{t("admin.course.offerings")}</h3>
        {offerings.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.course.noOfferings")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-panel">
            {offerings.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
                <Link href={`/admin/offerings/${o.id}`} className="min-w-0 text-primary underline-offset-2 hover:underline">
                  {o.code} · {o.cohorts?.name ?? ""}
                </Link>
                <span className="flex items-center gap-2 text-sm text-muted">
                  {t("admin.course.usesVersion", { n: versionNo.get(o.course_version_id) ?? "?" })} <OfferingStatusBadge status={o.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel aria-labelledby="course-rename">
          <PanelHeader id="course-rename" title={t("admin.course.rename")} />
          <ActionForm action={renameCourse} className="space-y-3 p-4 sm:px-6">
            <input type="hidden" name="course" value={course.id} />
            <Field label={t("admin.courses.courseTitle")} htmlFor="rename-title" hint={t("admin.course.renameHint")} required>
              <Input id="rename-title" name="title" required maxLength={300} defaultValue={course.title} aria-describedby="rename-title-hint" />
            </Field>
            <SubmitButton variant="secondary">{t("admin.common.save")}</SubmitButton>
          </ActionForm>
        </Panel>
        <Panel aria-labelledby="course-duplicate">
          <PanelHeader id="course-duplicate" title={t("admin.course.duplicate")} />
          <ActionForm action={duplicateCourse} className="space-y-3 p-4 sm:px-6">
            <input type="hidden" name="course" value={course.id} />
            <p className="text-sm text-muted">{t("admin.course.duplicateHelp")}</p>
            <Field label={t("admin.course.newCode")} htmlFor="dup-code" required>
              <Input id="dup-code" name="code" required minLength={2} maxLength={64} pattern="[A-Za-z0-9_.\-]{2,64}" />
            </Field>
            <Field label={t("admin.course.newTitle")} htmlFor="dup-title" required>
              <Input id="dup-title" name="title" required maxLength={300} defaultValue={t("admin.course.copyOf", { title: course.title })} />
            </Field>
            <SubmitButton variant="secondary">{t("admin.course.duplicateButton")}</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </PageBody>
  );
}
