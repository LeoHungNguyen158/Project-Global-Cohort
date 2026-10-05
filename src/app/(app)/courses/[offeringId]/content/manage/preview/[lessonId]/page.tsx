import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, Pencil } from "lucide-react";
import { requireAuthor, requireCourseVersion } from "@/lib/learning/authoring";
import { loadLessonAssets, loadLessonContent, loadVersionStructure } from "@/lib/learning/data";
import { isUuid } from "@/lib/forms";
import { LessonViewer } from "@/components/learning/lesson-viewer";
import { LessonHeader, LessonNav } from "@/components/learning/lesson-chrome";
import { ManageHeader } from "@/components/learning/authoring/manage-header";
import { PageBody } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

type Params = { offeringId: string; lessonId: string };

const STATUS_LABEL = { draft: "author.status.draft", published: "author.status.published", archived: "author.status.archived" } as const;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, lessonId } = await params;
  await requireAuthor(offeringId);
  const lesson = isUuid(lessonId) ? await loadLessonContent(lessonId) : null;
  return lesson ? { title: `${t("author.lesson.preview")}: ${lesson.title}` } : {};
}

/**
 * Read-only preview of any version's lesson for authors, rendered with the learner
 * lesson viewer. Nothing is recorded: the player does not save positions and the
 * completion control is disabled with the reason.
 */
export default async function LessonPreviewPage({ params }: { params: Promise<Params> }) {
  const { offeringId, lessonId } = await params;
  const access = await requireAuthor(offeringId);
  if (!isUuid(lessonId)) notFound();
  const lesson = await loadLessonContent(lessonId);
  if (!lesson) notFound();
  const version = await requireCourseVersion(lesson.course_version_id, access.offering.course_id);
  const [structure, assets] = await Promise.all([loadVersionStructure(version.id), loadLessonAssets(lessonId)]);

  const flat = structure.flatMap((m) => m.lessons.map((l) => ({ lesson: l, module: m })));
  const index = flat.findIndex((x) => x.lesson.id === lessonId);
  const moduleTitle = index >= 0 ? flat[index].module.title : "";
  const prev = index > 0 ? flat[index - 1].lesson : null;
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1].lesson : null;
  const base = `/courses/${offeringId}/content/manage`;
  const versionHref = `${base}/versions/${version.id}`;
  const isDraft = version.status === "draft";
  const detail = t("learn.preview.draftDetail", { version: version.version_no, status: t(STATUS_LABEL[version.status]).toLowerCase() });

  return (
    <PageBody>
      <div className="mx-auto max-w-4xl space-y-6">
        <ManageHeader
          offeringId={offeringId}
          current={null}
          intro={false}
          crumbs={[
            { label: t("author.nav.overview"), href: base },
            { label: t("author.version.title", { n: version.version_no }), href: versionHref },
            { label: `${t("author.lesson.preview")}: ${lesson.title}` },
          ]}
        />
        <div role="note" className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[#c7d6fb] bg-primary-soft px-4 py-3 text-sm">
          <div className="flex gap-3">
            <Eye aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{isDraft ? t("learn.preview.draft") : t("learn.preview.staff")}</p>
              <p>{detail}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={versionHref} className={buttonClass("secondary", "sm")}>{t("learn.preview.backToEditor")}</Link>
            {isDraft ? (
              <Link href={`${versionHref}/lessons/${lesson.id}`} className={buttonClass("secondary", "sm")}>
                <Pencil aria-hidden="true" className="h-4 w-4" /> {t("learn.preview.editLesson")}
              </Link>
            ) : null}
          </div>
        </div>

        <article aria-labelledby="preview-title" className="space-y-6">
          <LessonHeader
            id="preview-title"
            title={lesson.title}
            context={`${t("learn.lesson.inModule", { title: moduleTitle })} · ${t("learn.lesson.position", { n: index + 1, total: flat.length })}`}
            contentType={lesson.content_type}
            required={lesson.required}
            durationMinutes={lesson.duration_minutes}
          />
          <LessonViewer
            offeringId={offeringId}
            lesson={lesson}
            assets={assets}
            record={false}
            progress={null}
            completion={{ doneLabel: null, disabledReason: t("learn.complete.staffDisabled") }}
            idPrefix="preview"
          />
          <LessonNav
            prev={prev ? { href: `${base}/preview/${prev.id}`, title: prev.title } : null}
            next={next ? { href: `${base}/preview/${next.id}`, title: next.title } : null}
            back={{ href: versionHref, label: t("learn.preview.backToEditor") }}
          />
        </article>
      </div>
    </PageBody>
  );
}
