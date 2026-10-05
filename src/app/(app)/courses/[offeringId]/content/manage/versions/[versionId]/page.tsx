import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Pencil, Plus, Rocket, Trash2 } from "lucide-react";
import { requireAuthor, requireCourseVersion, loadCourseOfferings } from "@/lib/learning/authoring";
import { loadVersionStructure, type StructureModule } from "@/lib/learning/data";
import { LESSON_CONTENT_TYPES, LIMITS } from "@/lib/learning/validate";
import { formatDateTime } from "@/lib/time";
import {
  addLesson,
  addModule,
  moveLesson,
  moveModule,
  publishVersion,
  removeLesson,
  removeModule,
  updateModule,
  updateVersionDetails,
} from "@/app/actions/authoring";
import { ManageHeader, VersionStatusBadge } from "@/components/learning/authoring/manage-header";
import { MoveButtons } from "@/components/learning/authoring/move-buttons";
import { ActionNotice } from "@/components/learning/authoring/action-notice";
import { parseNotice } from "@/lib/learning/notices";
import { ContentTypeIcon, contentTypeLabel, RequiredBadge } from "@/components/learning/lesson-badges";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MarkdownField } from "@/components/ui/markdown-field";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { RichText } from "@/components/ui/rich-text";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

type Params = { offeringId: string; versionId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, versionId } = await params;
  const access = await requireAuthor(offeringId);
  const version = await requireCourseVersion(versionId, access.offering.course_id);
  return { title: t("author.version.title", { n: version.version_no }) };
}

export default async function VersionPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ notice?: string }> }) {
  const { offeringId, versionId } = await params;
  const notice = parseNotice((await searchParams).notice);
  const access = await requireAuthor(offeringId);
  const { offering, user } = access;
  const version = await requireCourseVersion(versionId, offering.course_id);
  const [structure, offerings] = await Promise.all([loadVersionStructure(versionId), loadCourseOfferings(offering.course_id)]);
  const editable = version.status === "draft";
  const base = `/courses/${offeringId}/content/manage`;
  const usedBy = offerings.filter((o) => o.course_version_id === versionId).map((o) => o.code);
  const lessonCount = structure.reduce((n, m) => n + m.lessons.length, 0);
  const noticeText =
    notice === "published" && version.status === "published"
      ? t("author.draft.published", { n: version.version_no })
      : notice === "moduleRemoved" && editable
        ? t("author.module.removed")
        : notice === "lessonRemoved" && editable
          ? t("author.lesson.removed")
          : null;

  return (
    <PageBody>
      <div className="mx-auto max-w-6xl space-y-6">
        <ManageHeader
          offeringId={offeringId}
          current={null}
          intro={false}
          crumbs={[{ label: t("author.nav.overview"), href: base }, { label: t("author.version.title", { n: version.version_no }) }]}
        />
        <ActionNotice message={noticeText} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {t("author.version.title", { n: version.version_no })} <VersionStatusBadge status={version.status} />
            </h3>
            <p className="text-sm text-muted">
              {usedBy.length > 0 ? t("author.version.usedBy", { codes: usedBy.join(", ") }) : t("author.versions.notUsed")}
              {version.published_at ? ` · ${t("author.versions.published", { date: formatDateTime(version.published_at, user.timezone) })}` : ""}
            </p>
          </div>
          {editable ? (
            <ConfirmForm
              action={publishVersion}
              fields={{ offeringId, versionId, returnTo: "version" }}
              trigger={
                <>
                  <Rocket aria-hidden="true" className="h-4 w-4" /> {t("author.draft.publish")}
                </>
              }
              triggerVariant="primary"
              title={t("author.draft.publishTitle", { n: version.version_no })}
              description={t("author.draft.publishBody")}
              confirmLabel={t("author.draft.publish")}
              disabled={lessonCount === 0}
            />
          ) : null}
        </div>
        {editable && lessonCount === 0 ? <p className="text-sm text-muted">{t("author.version.publishNeedsLesson")}</p> : null}
        {!editable ? <Alert tone="info">{t("author.version.readOnly")}</Alert> : null}

        <Panel aria-labelledby="version-details">
          <PanelHeader id="version-details" title={t("author.version.details")} />
          <div className="px-4 py-4 sm:px-6">
            {editable ? (
              <ActionForm action={updateVersionDetails} className="space-y-4">
                <input type="hidden" name="offeringId" value={offeringId} />
                <input type="hidden" name="versionId" value={versionId} />
                <Field label={t("author.version.titleField")} htmlFor="v-title" required>
                  <Input id="v-title" name="title" defaultValue={version.title} required maxLength={LIMITS.title} />
                </Field>
                <Field label={t("author.version.summary")} htmlFor="v-summary" hint={t("author.version.summaryHint")}>
                  <Textarea id="v-summary" name="summary" defaultValue={version.summary} maxLength={LIMITS.summary} rows={3} aria-describedby="v-summary-hint" />
                </Field>
                <Field label={t("author.version.objectives")} htmlFor="v-objectives" hint={t("author.version.objectivesHint")}>
                  <Textarea id="v-objectives" name="objectives" defaultValue={version.objectives.join("\n")} rows={4} aria-describedby="v-objectives-hint" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("author.version.audience")} htmlFor="v-audience">
                    <Input id="v-audience" name="audience" defaultValue={version.audience} maxLength={LIMITS.shortText} />
                  </Field>
                  <Field label={t("author.version.effort")} htmlFor="v-effort" hint={t("author.version.effortHint")}>
                    <Input id="v-effort" name="effort" defaultValue={version.expected_effort} maxLength={LIMITS.shortText} aria-describedby="v-effort-hint" />
                  </Field>
                </div>
                <Field label={t("author.version.prereq")} htmlFor="v-prereq" hint={t("author.version.prereqHint")}>
                  <Textarea id="v-prereq" name="prerequisites" defaultValue={version.prerequisites_text} maxLength={LIMITS.longText} rows={3} aria-describedby="v-prereq-hint" />
                </Field>
                <MarkdownField name="syllabus" label={t("author.version.syllabus")} html={version.syllabus_html} rows={8} maxLength={LIMITS.body} />
                <Field label={t("author.version.grading")} htmlFor="v-grading" hint={t("author.version.gradingHint")}>
                  <Textarea id="v-grading" name="grading" defaultValue={version.grading_policy} maxLength={LIMITS.longText} rows={4} aria-describedby="v-grading-hint" />
                </Field>
                <SubmitButton>{t("author.version.saveDetails")}</SubmitButton>
              </ActionForm>
            ) : (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("author.version.titleField")}</dt>
                  <dd>{version.title}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("author.version.summary")}</dt>
                  <dd className="whitespace-pre-line">{version.summary || t("learn.overview.notProvided")}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("author.version.objectives")}</dt>
                  <dd>
                    {version.objectives.length > 0 ? (
                      <ul className="list-disc pl-5">
                        {version.objectives.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    ) : (
                      t("learn.overview.notProvided")
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">{t("author.version.audience")}</dt>
                  <dd>{version.audience || t("learn.overview.notProvided")}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t("author.version.effort")}</dt>
                  <dd>{version.expected_effort || t("learn.overview.notProvided")}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("author.version.prereq")}</dt>
                  <dd className="whitespace-pre-line">{version.prerequisites_text || t("learn.overview.notProvided")}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("author.version.syllabus")}</dt>
                  <dd>
                    <RichText html={version.syllabus_html} className="break-words" />
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("author.version.grading")}</dt>
                  <dd className="whitespace-pre-line">{version.grading_policy || t("learn.overview.notProvided")}</dd>
                </div>
              </dl>
            )}
          </div>
        </Panel>

        <section aria-labelledby="version-structure" className="space-y-4">
          <h3 id="version-structure" className="text-lg font-semibold">{t("author.structure.title")}</h3>
          {structure.length === 0 ? <EmptyState title={editable ? t("author.structure.empty") : t("learn.content.empty")} /> : null}
          <ol className="space-y-4">
            {structure.map((m, i) => (
              <li key={m.id}>
                <ModuleCard offeringId={offeringId} versionId={versionId} module={m} index={i} count={structure.length} editable={editable} />
              </li>
            ))}
          </ol>

          {editable ? (
            <Panel aria-labelledby="add-module">
              <PanelHeader id="add-module" title={t("author.module.addTitle")} level={3} />
              <div className="px-4 py-4 sm:px-6">
                <ActionForm action={addModule} resetOnSuccess className="space-y-4">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="versionId" value={versionId} />
                  <Field label={t("author.module.title")} htmlFor="new-module-title" required>
                    <Input id="new-module-title" name="title" required maxLength={LIMITS.title} />
                  </Field>
                  <Field label={t("author.module.description")} htmlFor="new-module-description">
                    <Textarea id="new-module-description" name="description" rows={2} maxLength={LIMITS.moduleDescription} />
                  </Field>
                  <SubmitButton variant="secondary">
                    <Plus aria-hidden="true" className="h-4 w-4" /> {t("author.module.add")}
                  </SubmitButton>
                </ActionForm>
              </div>
            </Panel>
          ) : null}
        </section>
      </div>
    </PageBody>
  );
}

function ModuleCard({
  offeringId,
  versionId,
  module: m,
  index,
  count,
  editable,
}: {
  offeringId: string;
  versionId: string;
  module: StructureModule;
  index: number;
  count: number;
  editable: boolean;
}) {
  const base = `/courses/${offeringId}/content/manage`;
  const headingId = `module-${m.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius-panel)] border border-line bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("learn.content.module", { n: index + 1 })}</p>
          <h4 id={headingId} className="break-words text-lg font-semibold">{m.title}</h4>
          {m.description ? <p className="text-sm text-muted">{m.description}</p> : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <MoveButtons action={moveModule} fields={{ offeringId, moduleId: m.id }} title={m.title} canUp={index > 0} canDown={index < count - 1} />
            <ConfirmForm
              action={removeModule}
              fields={{ offeringId, moduleId: m.id }}
              trigger={
                <>
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">{t("author.module.removeNamed", { title: m.title })}</span>
                </>
              }
              triggerVariant="ghost"
              size="sm"
              tone="danger"
              title={t("author.module.removeTitle", { title: m.title })}
              description={t("author.module.removeBody", { count: m.lessons.length })}
              confirmLabel={t("author.module.remove")}
            />
          </div>
        ) : null}
      </div>

      {editable ? (
        <div className="border-b border-line px-4 py-2 sm:px-6">
          <Disclosure summary={t("author.module.edit")} summaryClassName="min-h-10">
            <ActionForm action={updateModule} className="space-y-3 pb-2">
              <input type="hidden" name="offeringId" value={offeringId} />
              <input type="hidden" name="moduleId" value={m.id} />
              <Field label={t("author.module.title")} htmlFor={`module-title-${m.id}`} required>
                <Input id={`module-title-${m.id}`} name="title" defaultValue={m.title} required maxLength={LIMITS.title} />
              </Field>
              <Field label={t("author.module.description")} htmlFor={`module-description-${m.id}`}>
                <Textarea id={`module-description-${m.id}`} name="description" defaultValue={m.description} rows={2} maxLength={LIMITS.moduleDescription} />
              </Field>
              <SubmitButton variant="secondary" size="sm">{t("author.module.save")}</SubmitButton>
            </ActionForm>
          </Disclosure>
        </div>
      ) : null}

      {m.lessons.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted sm:px-6">{t("author.module.empty")}</p>
      ) : (
        <ol className="divide-y divide-line">
          {m.lessons.map((l, li) => (
            <li key={l.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <ContentTypeIcon type={l.content_type} className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
                <div className="min-w-0">
                  <p className="break-words font-medium">{l.title}</p>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>{contentTypeLabel(l.content_type)}</span>
                    <RequiredBadge required={l.required} />
                    {l.duration_minutes !== null ? <span>{t("learn.lesson.minutes", { count: l.duration_minutes })}</span> : null}
                    <span>{l.file_count === 1 ? t("author.lesson.filesOne") : t("author.lesson.files", { count: l.file_count })}</span>
                    {l.completion_rule === "video_watched" ? <span>{t("author.lesson.playbackRule")}</span> : null}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-0">
                {editable ? (
                  <MoveButtons action={moveLesson} fields={{ offeringId, lessonId: l.id }} title={l.title} canUp={li > 0} canDown={li < m.lessons.length - 1} />
                ) : null}
                {editable ? (
                  <Link href={`${base}/versions/${versionId}/lessons/${l.id}`} className={buttonClass("secondary", "sm")} aria-label={t("author.lesson.editNamed", { title: l.title })}>
                    <Pencil aria-hidden="true" className="h-4 w-4" /> {t("author.lesson.edit")}
                  </Link>
                ) : null}
                <Link href={`${base}/preview/${l.id}`} className={buttonClass("secondary", "sm")} aria-label={t("author.lesson.previewNamed", { title: l.title })}>
                  <Eye aria-hidden="true" className="h-4 w-4" /> {t("author.lesson.preview")}
                </Link>
                {editable ? (
                  <ConfirmForm
                    action={removeLesson}
                    fields={{ offeringId, lessonId: l.id }}
                    trigger={
                      <>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                        <span className="sr-only">{t("author.lesson.removeNamed", { title: l.title })}</span>
                      </>
                    }
                    triggerVariant="ghost"
                    size="sm"
                    tone="danger"
                    title={t("author.lesson.removeTitle", { title: l.title })}
                    description={t("author.lesson.removeBody")}
                    confirmLabel={t("author.lesson.remove")}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {editable ? (
        <div className="border-t border-line px-4 py-2 sm:px-6">
          <Disclosure summary={t("author.lesson.addTo", { module: m.title })} summaryClassName="min-h-10">
            <ActionForm action={addLesson} className="grid gap-3 pb-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
              <input type="hidden" name="offeringId" value={offeringId} />
              <input type="hidden" name="moduleId" value={m.id} />
              <Field label={t("author.lesson.title")} htmlFor={`new-lesson-title-${m.id}`} required>
                <Input id={`new-lesson-title-${m.id}`} name="title" required maxLength={LIMITS.title} />
              </Field>
              <Field label={t("author.lesson.type")} htmlFor={`new-lesson-type-${m.id}`}>
                <Select id={`new-lesson-type-${m.id}`} name="contentType" defaultValue="text">
                  {LESSON_CONTENT_TYPES.map((type) => (
                    <option key={type} value={type}>{contentTypeLabel(type)}</option>
                  ))}
                </Select>
              </Field>
              <SubmitButton variant="secondary">
                <Plus aria-hidden="true" className="h-4 w-4" /> {t("author.lesson.add")}
              </SubmitButton>
            </ActionForm>
          </Disclosure>
        </div>
      ) : null}
    </section>
  );
}
