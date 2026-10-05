import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import { createCourse } from "@/app/actions/admin/courses";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/admin/badges";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.courses.title") };

type CourseRow = {
  id: string;
  code: string;
  title: string;
  is_sample: boolean;
  archived_at: string | null;
  course_versions: { version_no: number; status: string }[];
  course_offerings: { id: string }[];
};

export default async function AdminCoursesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const sp = await searchParams;
  await requirePlatformAdmin("/admin/courses");
  const showArchived = sp.archived === "1";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .select("id, code, title, is_sample, archived_at, course_versions(version_no, status), course_offerings(id)")
    .order("code");
  if (error) throw new Error("Could not load courses");
  const all = ((data ?? []) as CourseRow[]).sort((a, b) => a.code.localeCompare(b.code));
  const courses = all.filter((c) => showArchived || !c.archived_at);
  const archivedCount = all.filter((c) => c.archived_at).length;

  return (
    <PageBody className="space-y-6">
      <SectionTitle title={t("admin.courses.title")} description={t("admin.courses.description")} />

      <Panel aria-labelledby="new-course">
        <PanelHeader id="new-course" title={t("admin.courses.newTitle")} />
        <ActionForm action={createCourse} className="flex flex-wrap items-end gap-3 p-4 sm:px-6">
          <Field label={t("admin.common.code")} htmlFor="course-code" hint={t("admin.courses.codeHint")} required className="min-w-[10rem] flex-1">
            <Input id="course-code" name="code" required minLength={2} maxLength={64} pattern="[A-Za-z0-9_.\-]{2,64}" aria-describedby="course-code-hint" />
          </Field>
          <Field label={t("admin.courses.courseTitle")} htmlFor="course-title" required className="min-w-[14rem] flex-[2_1_14rem]">
            <Input id="course-title" name="title" required maxLength={300} />
          </Field>
          <SubmitButton>{t("admin.courses.create")}</SubmitButton>
        </ActionForm>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" aria-live="polite">{courses.length === 1 ? t("admin.common.result") : t("admin.common.results", { count: courses.length })}</p>
        {archivedCount > 0 ? (
          <Link href={showArchived ? "/admin/courses" : "/admin/courses?archived=1"} className="inline-flex min-h-10 items-center text-sm text-primary underline-offset-2 hover:underline">
            {showArchived ? t("admin.courses.hideArchived") : t("admin.courses.showArchived", { count: archivedCount })}
          </Link>
        ) : null}
      </div>

      {courses.length === 0 ? (
        <EmptyState title={t("admin.courses.empty")} />
      ) : (
        <Table caption={t("admin.courses.caption")} captionHidden>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("admin.courses.courseTitle")}</th>
              <th scope="col" className={th}>{t("admin.common.code")}</th>
              <th scope="col" className={th}>{t("admin.courses.versions")}</th>
              <th scope="col" className={th}>{t("admin.nav.offerings")}</th>
              <th scope="col" className={th}>{t("admin.common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => {
              const published = c.course_versions.filter((v) => v.status === "published").sort((a, b) => b.version_no - a.version_no)[0];
              const draft = c.course_versions.find((v) => v.status === "draft");
              return (
                <tr key={c.id}>
                  <td className={td}>
                    <Link href={`/admin/courses/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{c.title}</Link>
                    {c.is_sample ? <Badge className="ml-2">{t("admin.common.sample")}</Badge> : null}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{c.code}</td>
                  <td className={td}>
                    {published ? t("admin.courses.publishedVersion", { n: published.version_no }) : t("admin.courses.noPublished")}
                    {draft ? <span className="block text-xs text-muted">{t("admin.courses.draftVersion", { n: draft.version_no })}</span> : null}
                  </td>
                  <td className={`${td} tabular-nums`}>{c.course_offerings.length}</td>
                  <td className={td}>{c.archived_at ? <Badge>{t("admin.courses.archivedBadge")}</Badge> : <Badge tone="success">{t("admin.courses.activeBadge")}</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </PageBody>
  );
}
