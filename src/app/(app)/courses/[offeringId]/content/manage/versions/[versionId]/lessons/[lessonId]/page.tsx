import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Trash2 } from "lucide-react";
import { requireAuthor, requireCourseVersion, requireVersionLesson } from "@/lib/learning/authoring";
import { loadLessonAssets, loadVersionStructure, type LessonAsset } from "@/lib/learning/data";
import { LESSON_CONTENT_TYPES, LIMITS } from "@/lib/learning/validate";
import { describeFileType, languageLabel } from "@/lib/learning/assets";
import { embedWatchUrl, isAllowedEmbed, type EmbedProvider } from "@/lib/learning/embed";
import { formatBytes } from "@/lib/uploads/mime";
import { moveFile, removeFile, updateFileDetails, updateFileRole, updateLesson } from "@/app/actions/authoring";
import { ManageHeader, VersionStatusBadge } from "@/components/learning/authoring/manage-header";
import { MoveButtons } from "@/components/learning/authoring/move-buttons";
import { AttachFilesForm } from "@/components/learning/authoring/attach-files-form";
import { ActionNotice } from "@/components/learning/authoring/action-notice";
import { parseNotice } from "@/lib/learning/notices";
import { contentTypeLabel, RequiredBadge } from "@/components/learning/lesson-badges";
import { FileList } from "@/components/learning/lesson-viewer";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { MarkdownField } from "@/components/ui/markdown-field";
import { Disclosure } from "@/components/ui/disclosure";
import { RichText } from "@/components/ui/rich-text";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

type Params = { offeringId: string; versionId: string; lessonId: string };

const ROLE_LABEL = {
  primary: "author.files.role.primary",
  captions: "author.files.role.captions",
  attachment: "author.files.role.attachment",
} as const;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, versionId, lessonId } = await params;
  const access = await requireAuthor(offeringId);
  await requireCourseVersion(versionId, access.offering.course_id);
  const lesson = await requireVersionLesson(lessonId, versionId);
  return { title: `${t("author.lessonEdit.title")}: ${lesson.title}` };
}

export default async function LessonEditorPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ created?: string; notice?: string }> }) {
  const { offeringId, versionId, lessonId } = await params;
  const { created, notice: rawNotice } = await searchParams;
  const notice = parseNotice(rawNotice);
  const access = await requireAuthor(offeringId);
  const version = await requireCourseVersion(versionId, access.offering.course_id);
  const lesson = await requireVersionLesson(lessonId, versionId);
  const [structure, assets] = await Promise.all([loadVersionStructure(versionId), loadLessonAssets(lessonId)]);
  const editable = version.status === "draft";
  const base = `/courses/${offeringId}/content/manage`;
  const versionHref = `${base}/versions/${versionId}`;
  const embedOk = isAllowedEmbed(lesson.embed_provider, lesson.embed_id);
  const currentEmbed = embedOk ? embedWatchUrl(lesson.embed_provider as EmbedProvider, lesson.embed_id as string) : null;
  const moduleTitle = structure.find((m) => m.id === lesson.module_id)?.title ?? "";

  return (
    <PageBody>
      <div className="mx-auto max-w-5xl space-y-6">
        <ManageHeader
          offeringId={offeringId}
          current={null}
          intro={false}
          crumbs={[
            { label: t("author.nav.overview"), href: base },
            { label: t("author.version.title", { n: version.version_no }), href: versionHref },
            { label: lesson.title },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              {t("author.version.title", { n: version.version_no })} <VersionStatusBadge status={version.status} /> · {moduleTitle}
            </p>
            <h3 className="break-words text-xl font-semibold">{editable ? t("author.lessonEdit.titleNamed", { title: lesson.title }) : lesson.title}</h3>
          </div>
          <Link href={`${base}/preview/${lesson.id}`} className={buttonClass("secondary", "sm")}>
            <Eye aria-hidden="true" className="h-4 w-4" /> {t("author.lesson.previewNamed", { title: lesson.title })}
          </Link>
        </div>

        {created === "1" && editable ? <Alert tone="success" live>{t("author.lessonEdit.created")}</Alert> : null}
        <ActionNotice message={notice === "fileRemoved" && editable ? t("author.files.removed") : null} />
        {!editable ? <Alert tone="info">{t("author.lessonEdit.readOnly")}</Alert> : null}

        <Panel aria-labelledby="lesson-basics">
          <PanelHeader id="lesson-basics" title={t("author.lessonEdit.basics")} level={3} />
          <div className="px-4 py-4 sm:px-6">
            {editable ? (
              <ActionForm action={updateLesson} className="space-y-4">
                <input type="hidden" name="offeringId" value={offeringId} />
                <input type="hidden" name="lessonId" value={lesson.id} />
                <Field label={t("author.lesson.title")} htmlFor="l-title" required>
                  <Input id="l-title" name="title" defaultValue={lesson.title} required maxLength={LIMITS.title} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("author.lessonEdit.module")} htmlFor="l-module" hint={t("author.lessonEdit.moduleHint")}>
                    <Select id="l-module" name="moduleId" defaultValue={lesson.module_id} aria-describedby="l-module-hint">
                      {structure.map((m, i) => (
                        <option key={m.id} value={m.id}>
                          {t("learn.content.module", { n: i + 1 })}: {m.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("author.lesson.type")} htmlFor="l-type">
                    <Select id="l-type" name="contentType" defaultValue={lesson.content_type}>
                      {LESSON_CONTENT_TYPES.map((type) => (
                        <option key={type} value={type}>{contentTypeLabel(type)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("author.lessonEdit.duration")} htmlFor="l-duration">
                    <Input id="l-duration" name="duration" type="number" min={0} max={LIMITS.durationMax} step={1} inputMode="numeric" defaultValue={lesson.duration_minutes ?? ""} />
                  </Field>
                  <Field label={t("author.lessonEdit.rule")} htmlFor="l-rule" hint={t("author.lessonEdit.ruleHint")}>
                    <Select id="l-rule" name="completionRule" defaultValue={lesson.completion_rule} aria-describedby="l-rule-hint">
                      <option value="acknowledge">{t("author.lessonEdit.ruleAck")}</option>
                      <option value="video_watched">{t("author.lessonEdit.ruleVideo")}</option>
                    </Select>
                  </Field>
                </div>
                <div>
                  <Checkbox name="required" defaultChecked={lesson.required} label={t("author.lessonEdit.required")} aria-describedby="l-required-hint" />
                  <p id="l-required-hint" className="text-xs text-muted">{t("author.lessonEdit.requiredHint")}</p>
                </div>
                <MarkdownField name="body" label={t("author.lessonEdit.body")} html={lesson.body_html} rows={10} maxLength={LIMITS.body} />
                <Field label={t("author.lessonEdit.externalUrl")} htmlFor="l-external" hint={t("author.lessonEdit.externalUrlHint")}>
                  <Input id="l-external" name="externalUrl" type="url" inputMode="url" placeholder="https://" defaultValue={lesson.external_url ?? ""} maxLength={2000} aria-describedby="l-external-hint" />
                </Field>
                <Field label={t("author.lessonEdit.embedUrl")} htmlFor="l-embed" hint={t("author.lessonEdit.embedUrlHint")}>
                  <Input id="l-embed" name="embedUrl" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" defaultValue={currentEmbed ?? ""} maxLength={2000} aria-describedby="l-embed-hint" />
                </Field>
                {embedOk ? (
                  <p className="text-sm text-muted">
                    {t("author.lessonEdit.embedCurrent", {
                      provider: t(lesson.embed_provider === "vimeo" ? "learn.embed.vimeo" : "learn.embed.youtube"),
                      id: lesson.embed_id ?? "",
                    })}
                  </p>
                ) : null}
                <Field label={t("author.lessonEdit.transcript")} htmlFor="l-transcript" hint={t("author.lessonEdit.transcriptHint")}>
                  <Textarea id="l-transcript" name="transcript" defaultValue={lesson.transcript} rows={6} maxLength={LIMITS.transcript} aria-describedby="l-transcript-hint" />
                </Field>
                <SubmitButton>{t("author.lessonEdit.save")}</SubmitButton>
              </ActionForm>
            ) : (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">{t("author.lesson.type")}</dt>
                  <dd>{contentTypeLabel(lesson.content_type)}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t("author.lessonEdit.required")}</dt>
                  <dd>
                    <RequiredBadge required={lesson.required} />
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">{t("author.lessonEdit.duration")}</dt>
                  <dd>{lesson.duration_minutes ?? t("learn.overview.notProvided")}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t("author.lessonEdit.rule")}</dt>
                  <dd>{lesson.completion_rule === "video_watched" ? t("author.lessonEdit.ruleVideo") : t("author.lessonEdit.ruleAck")}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("author.lessonEdit.body")}</dt>
                  <dd>
                    <RichText html={lesson.body_html} className="break-words" />
                  </dd>
                </div>
                {lesson.external_url ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold">{t("author.lessonEdit.externalUrl")}</dt>
                    <dd className="break-all">{lesson.external_url}</dd>
                  </div>
                ) : null}
                {currentEmbed ? (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold">{t("author.lessonEdit.embedUrl")}</dt>
                    <dd className="break-all">{currentEmbed}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </div>
        </Panel>

        <Panel aria-labelledby="lesson-files">
          <PanelHeader id="lesson-files" title={t("author.files.title")} level={3} />
          <div className="space-y-6 px-4 py-4 sm:px-6">
            {assets.length === 0 ? (
              <p className="text-sm text-muted">{t("author.files.empty")}</p>
            ) : editable ? (
              <ol aria-label={t("author.files.caption")} className="divide-y divide-line rounded-[var(--radius-panel)] border border-line">
                {assets.map((a, i) => (
                  <FileRow key={a.id} offeringId={offeringId} lessonId={lesson.id} asset={a} index={i} count={assets.length} />
                ))}
              </ol>
            ) : (
              <FileList items={assets} showOwner />
            )}
            {editable ? (
              <section aria-labelledby="lesson-add-files" className="space-y-3 border-t border-line pt-4">
                <h4 id="lesson-add-files" className="font-semibold">{t("author.files.add")}</h4>
                <AttachFilesForm offeringId={offeringId} lessonId={lesson.id} courseVersionId={versionId} />
              </section>
            ) : null}
          </div>
        </Panel>

        <Link href={versionHref} className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline underline-offset-2">
          {t("author.lessonEdit.back", { n: version.version_no })}
        </Link>
      </div>
    </PageBody>
  );
}

function FileRow({ offeringId, lessonId, asset: a, index, count }: { offeringId: string; lessonId: string; asset: LessonAsset; index: number; count: number }) {
  const name = a.title?.trim() || a.filename;
  const ids = { offeringId, lessonId, assetId: a.id };
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium">{name}</p>
          <p className="break-all text-sm text-muted">
            {a.filename} · {describeFileType(a.mime, a.filename)} · {formatBytes(a.size)}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={a.role === "primary" ? "info" : "neutral"}>{t(ROLE_LABEL[a.role])}</Badge>
            {a.role === "captions" && a.caption_language ? (
              <span>{t("author.files.languageValue", { language: `${languageLabel(a.caption_language)} (${a.caption_language})` })}</span>
            ) : null}
            {a.status !== "ready" ? <Badge tone="warning">{t("author.files.notReady")}</Badge> : null}
            {a.owner_name ? <span className="text-muted">{t("author.files.uploadedBy", { name: a.owner_name })}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MoveButtons action={moveFile} fields={ids} title={name} canUp={index > 0} canDown={index < count - 1} />
          <ConfirmForm
            action={removeFile}
            fields={ids}
            trigger={
              <>
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                <span className="sr-only">{t("author.files.removeNamed", { name })}</span>
              </>
            }
            triggerVariant="ghost"
            size="sm"
            tone="danger"
            title={t("author.files.removeTitle", { name })}
            description={t("author.files.removeBody")}
            confirmLabel={t("author.files.remove")}
          />
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Disclosure summary={t("author.files.metadataNamed", { name })} summaryClassName="min-h-10">
          <ActionForm action={updateFileDetails} className="space-y-3">
            <input type="hidden" name="offeringId" value={offeringId} />
            <input type="hidden" name="assetId" value={a.id} />
            <Field label={t("author.files.titleField")} htmlFor={`f-title-${a.id}`}>
              <Input id={`f-title-${a.id}`} name="title" defaultValue={a.title} maxLength={LIMITS.assetTitle} />
            </Field>
            <Field label={t("author.files.descriptionField")} htmlFor={`f-desc-${a.id}`}>
              <Textarea id={`f-desc-${a.id}`} name="description" defaultValue={a.description} rows={2} maxLength={LIMITS.assetDescription} />
            </Field>
            <Field label={t("author.files.altField")} htmlFor={`f-alt-${a.id}`} hint={t("author.files.altHint")}>
              <Textarea id={`f-alt-${a.id}`} name="alt" defaultValue={a.alt_text} rows={2} maxLength={LIMITS.assetAlt} aria-describedby={`f-alt-${a.id}-hint`} />
            </Field>
            <SubmitButton variant="secondary" size="sm">{t("author.files.saveMeta")}</SubmitButton>
          </ActionForm>
        </Disclosure>
        <Disclosure summary={t("author.files.roleNamed", { name })} summaryClassName="min-h-10">
          <ActionForm action={updateFileRole} className="space-y-3">
            <input type="hidden" name="offeringId" value={offeringId} />
            <input type="hidden" name="lessonId" value={lessonId} />
            <input type="hidden" name="assetId" value={a.id} />
            <Field label={t("author.files.roleLabel")} htmlFor={`f-role-${a.id}`}>
              <Select id={`f-role-${a.id}`} name="role" defaultValue={a.role}>
                <option value="attachment">{t("author.files.role.attachment")}</option>
                <option value="primary">{t("author.files.role.primary")}</option>
                <option value="captions">{t("author.files.role.captions")}</option>
              </Select>
            </Field>
            <Field label={t("author.files.language")} htmlFor={`f-lang-${a.id}`} hint={t("author.files.languageHint")}>
              <Input id={`f-lang-${a.id}`} name="language" defaultValue={a.caption_language ?? ""} maxLength={5} pattern="[a-z]{2}(-[A-Z]{2})?" aria-describedby={`f-lang-${a.id}-hint`} />
            </Field>
            <SubmitButton variant="secondary" size="sm">{t("author.files.saveRole")}</SubmitButton>
          </ActionForm>
        </Disclosure>
      </div>
    </li>
  );
}
