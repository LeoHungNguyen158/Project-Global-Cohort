import type { ReactNode } from "react";
import { Download, ExternalLink, FileText, Image as ImageIcon, Paperclip, Captions } from "lucide-react";
import { RichText } from "@/components/ui/rich-text";
import { Disclosure } from "@/components/ui/disclosure";
import { buttonClass } from "@/components/ui/button";
import { formatBytes } from "@/lib/uploads/mime";
import { assetKind, describeFileType, languageLabel } from "@/lib/learning/assets";
import { assetUrl, type LessonAsset, type LessonContent, type LessonProgressRow } from "@/lib/learning/data";
import { embedPlayerUrl, embedWatchUrl, isAllowedEmbed, type EmbedProvider } from "@/lib/learning/embed";
import { completionMode } from "@/lib/learning/completion";
import { isHttpsUrl } from "@/lib/forms";
import { PlaybackProvider } from "./playback-context";
import { VideoPlayer } from "./video-player";
import { CompletionControl } from "./completion-control";
import { VisitRecorder } from "./visit-recorder";
import { t } from "@/i18n";

// Lesson content as learners see it. Staff previews and draft previews render the same
// component with recording off. Files are always linked through /api/assets, which checks
// access again (locks included) and redirects to a short-lived signed link.

export type ViewerCompletion = {
  /** Text such as "Completed Oct 5, 2026" when the learner already completed the lesson. */
  doneLabel: string | null;
  /** Why the control is disabled (staff preview, closed course, inactive enrollment). */
  disabledReason: string | null;
};

const PROVIDER_LABEL: Record<EmbedProvider, "learn.embed.youtube" | "learn.embed.vimeo"> = {
  youtube: "learn.embed.youtube",
  vimeo: "learn.embed.vimeo",
};

function displayName(a: LessonAsset): string {
  return a.title?.trim() || a.filename;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-lg font-semibold">
      {children}
    </h3>
  );
}

function ExternalAnchor({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <ExternalLink aria-hidden="true" className="h-4 w-4" />
      <span className="sr-only"> {t("learn.link.newTab")}</span>
    </a>
  );
}

export function LessonViewer({
  offeringId,
  lesson,
  assets,
  record,
  progress,
  completion,
  idPrefix = "lesson",
}: {
  offeringId: string;
  lesson: LessonContent;
  assets: LessonAsset[];
  /** True only for an active learner on an open lesson: positions and visits are saved. */
  record: boolean;
  progress: LessonProgressRow | null;
  completion: ViewerCompletion;
  idPrefix?: string;
}) {
  const ready = assets.filter((a) => a.status === "ready");
  const primary = ready.filter((a) => a.role === "primary");
  const videos = primary.filter((a) => assetKind(a.mime) === "video");
  const pdfs = primary.filter((a) => assetKind(a.mime) === "pdf");
  const images = primary.filter((a) => assetKind(a.mime) === "image");
  const captions = ready.filter((a) => a.role === "captions" && assetKind(a.mime) === "captions");
  const attachments = assets.filter((a) => a.role === "attachment");
  const notReady = assets.filter((a) => a.status !== "ready" && a.role !== "attachment");
  const hasVideo = videos.length > 0;
  const mode = completionMode(lesson.completion_rule, hasVideo);
  const embedOk = isAllowedEmbed(lesson.embed_provider, lesson.embed_id);
  const embedSrc = embedOk ? embedPlayerUrl(lesson.embed_provider as EmbedProvider, lesson.embed_id as string) : null;
  const watchUrl = embedOk ? embedWatchUrl(lesson.embed_provider as EmbedProvider, lesson.embed_id as string) : null;
  const providerName = embedOk ? t(PROVIDER_LABEL[lesson.embed_provider as EmbedProvider]) : "";
  const externalUrl = lesson.external_url && isHttpsUrl(lesson.external_url) ? lesson.external_url : null;
  const hasBody = Boolean(lesson.body_html && lesson.body_html.replace(/<[^>]*>/g, "").trim());
  const nothing = !hasVideo && pdfs.length === 0 && images.length === 0 && !embedSrc && !externalUrl && !hasBody && attachments.length === 0;

  const content = (
    <div className="space-y-8">
      {record && !hasVideo && !progress ? <VisitRecorder offeringId={offeringId} lessonId={lesson.id} /> : null}

      {hasBody ? (
        <section aria-label={t("learn.lesson.body")}>
          <RichText
            html={lesson.body_html}
            className="max-w-3xl break-words leading-relaxed [&_img]:h-auto [&_img]:max-w-full [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
          />
        </section>
      ) : null}

      {hasVideo ? (
        <section aria-labelledby={`${idPrefix}-video`} className="space-y-3">
          <h3 id={`${idPrefix}-video`} className="sr-only">{t("learn.video.label", { title: lesson.title })}</h3>
          <VideoPlayer
            offeringId={offeringId}
            lessonId={lesson.id}
            title={lesson.title}
            sources={videos.map((v) => ({ id: v.id, mime: v.mime }))}
            tracks={captions.map((c) => ({ id: c.id, lang: c.caption_language ?? "en", label: languageLabel(c.caption_language ?? "en") }))}
            initialPosition={progress?.last_position_seconds ?? 0}
            initialDuration={progress?.duration_seconds ?? null}
            record={record}
          />
          <p className="flex items-start gap-2 text-sm text-muted">
            <Captions aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {captions.length > 0
              ? t("learn.video.captions", { languages: captions.map((c) => languageLabel(c.caption_language ?? "en")).join(", ") })
              : t("learn.video.noCaptions")}
          </p>
          <Disclosure summary={t("learn.video.formats")} summaryClassName="min-h-10">
            <FileList items={[...videos, ...captions]} />
          </Disclosure>
        </section>
      ) : null}

      {pdfs.map((pdf) => (
        <section key={pdf.id} aria-label={t("learn.pdf.title", { title: displayName(pdf) })} className="space-y-3">
          <iframe
            src={assetUrl(pdf.id)}
            title={t("learn.pdf.title", { title: displayName(pdf) })}
            className="h-[70vh] min-h-[22rem] w-full rounded-md border border-line bg-white"
          />
          <div className="flex flex-wrap items-center gap-2">
            <a href={assetUrl(pdf.id, true)} className={buttonClass("primary", "sm")}>
              <Download aria-hidden="true" className="h-4 w-4" /> {t("learn.pdf.download")}
              <span className="sr-only">: {displayName(pdf)} ({formatBytes(pdf.size)})</span>
            </a>
            <a href={assetUrl(pdf.id)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
              {t("learn.pdf.openNewTab")}
              <span className="sr-only"> {t("learn.files.newTab")}</span>
            </a>
            <span className="text-sm text-muted">{t("learn.pdf.fallback")}</span>
          </div>
        </section>
      ))}

      {images.map((img) => (
        <figure key={img.id} className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- protected file served through /api/assets */}
          <img src={assetUrl(img.id)} alt={img.alt_text} className="h-auto max-w-full rounded-md border border-line" />
          <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {img.title ? <span>{img.title}</span> : null}
            <a href={assetUrl(img.id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-primary underline">
              <ImageIcon aria-hidden="true" className="h-4 w-4" /> {t("learn.image.open")}
              <span className="sr-only"> {t("learn.files.newTab")}</span>
            </a>
          </figcaption>
        </figure>
      ))}

      {embedSrc && watchUrl ? (
        <section aria-label={t("learn.embed.frameTitle", { provider: providerName, title: lesson.title })} className="space-y-2">
          <iframe
            src={embedSrc}
            title={t("learn.embed.frameTitle", { provider: providerName, title: lesson.title })}
            className="aspect-video w-full rounded-md border border-line bg-black"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{t("learn.embed.note", { provider: providerName })}</span>
            <ExternalAnchor href={watchUrl} className="inline-flex min-h-10 items-center gap-1 font-medium text-primary underline">
              {t("learn.embed.watchOn", { provider: providerName })}
            </ExternalAnchor>
          </p>
        </section>
      ) : lesson.embed_provider || lesson.embed_id ? (
        <p className="rounded-md border border-line bg-canvas px-4 py-3 text-sm">{t("learn.embed.invalid")}</p>
      ) : null}

      {externalUrl ? (
        <section aria-labelledby={`${idPrefix}-link`} className="rounded-[var(--radius-panel)] border border-line bg-panel p-4">
          <SectionHeading id={`${idPrefix}-link`}>{t("learn.link.title")}</SectionHeading>
          <p className="mt-1 break-all text-sm text-muted">{hostOf(externalUrl)}</p>
          <p className="mt-2 text-sm">{t("learn.link.note", { host: hostOf(externalUrl) })}</p>
          <ExternalAnchor href={externalUrl} className={buttonClass("primary", "md", "mt-3")}>
            {t("learn.link.open")}
          </ExternalAnchor>
        </section>
      ) : null}

      {nothing ? <p className="text-muted">{t("learn.lesson.noContent")}</p> : null}

      {notReady.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted">
          {notReady.map((a) => (
            <li key={a.id}>
              {displayName(a)}: {t("learn.files.notReady")}
            </li>
          ))}
        </ul>
      ) : null}

      {lesson.transcript.trim() ? (
        <section aria-labelledby={`${idPrefix}-transcript`} className="space-y-2">
          <SectionHeading id={`${idPrefix}-transcript`}>{t("learn.transcript.title")}</SectionHeading>
          <Disclosure summary={t("learn.transcript.show")} summaryClassName="min-h-10">
            <div className="max-w-3xl whitespace-pre-line rounded-md border border-line bg-panel p-4 text-sm leading-relaxed">{lesson.transcript}</div>
          </Disclosure>
        </section>
      ) : null}

      {attachments.length > 0 ? (
        <section aria-labelledby={`${idPrefix}-files`} className="space-y-3">
          <SectionHeading id={`${idPrefix}-files`}>{t("learn.files.title")}</SectionHeading>
          <FileList items={attachments} showOwner />
        </section>
      ) : null}

      <section aria-labelledby={`${idPrefix}-completion`} className="space-y-3 border-t border-line pt-6">
        <SectionHeading id={`${idPrefix}-completion`}>{t("learn.complete.title")}</SectionHeading>
        <CompletionControl
          offeringId={offeringId}
          lessonId={lesson.id}
          mode={mode}
          required={lesson.required}
          doneLabel={completion.doneLabel}
          disabledReason={completion.disabledReason}
        />
      </section>
    </div>
  );

  if (!hasVideo) return content;
  return (
    <PlaybackProvider initialMax={progress?.max_position_seconds ?? 0} initialDuration={progress?.duration_seconds ?? null}>
      {content}
    </PlaybackProvider>
  );
}

function fileIcon(mime: string) {
  const kind = assetKind(mime);
  if (kind === "pdf" || kind === "document" || kind === "presentation" || kind === "text") return FileText;
  if (kind === "image") return ImageIcon;
  if (kind === "captions") return Captions;
  return Paperclip;
}

/** Downloadable files with title, type and size; files still being checked are listed without a link. */
export function FileList({ items, showOwner }: { items: LessonAsset[]; showOwner?: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-panel">
      {items.map((a) => {
        const Icon = fileIcon(a.mime);
        const name = displayName(a);
        return (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
              <div className="min-w-0">
                <p className="break-words font-medium">{name}</p>
                <p className="break-all text-sm text-muted">
                  {a.title && a.title !== a.filename ? `${a.filename} · ` : ""}
                  {describeFileType(a.mime, a.filename)} · {formatBytes(a.size)}
                  {a.role === "captions" && a.caption_language ? ` · ${languageLabel(a.caption_language)}` : ""}
                </p>
                {a.description ? <p className="mt-1 text-sm">{a.description}</p> : null}
                {showOwner && a.owner_name ? <p className="text-xs text-muted">{t("learn.files.addedBy", { name: a.owner_name })}</p> : null}
              </div>
            </div>
            {a.status === "ready" ? (
              <a href={assetUrl(a.id, true)} className={buttonClass("secondary", "sm")} aria-label={t("learn.files.downloadNamed", { name })}>
                <Download aria-hidden="true" className="h-4 w-4" /> {t("learn.files.download")}
              </a>
            ) : (
              <span className="text-sm text-muted">{t("learn.files.notReady")}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
