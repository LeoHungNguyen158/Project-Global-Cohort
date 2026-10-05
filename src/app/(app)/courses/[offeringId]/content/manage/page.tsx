import type { Metadata } from "next";
import Link from "next/link";
import { Eye, FilePlus2, Pencil, Rocket, Send } from "lucide-react";
import { requireAuthor, loadCourseOfferings } from "@/lib/learning/authoring";
import { loadCourseVersions } from "@/lib/learning/data";
import { formatDate, formatDateTime } from "@/lib/time";
import { adoptVersion, createDraft, publishVersion, releaseOffering } from "@/app/actions/authoring";
import { ManageHeader, VersionStatusBadge } from "@/components/learning/authoring/manage-header";
import { ActionNotice } from "@/components/learning/authoring/action-notice";
import { parseNotice } from "@/lib/learning/notices";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { td, th } from "@/components/ui/table";
import { ScrollTable } from "@/components/learning/scroll-table";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("author.title") };

export default async function ManageContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { offeringId } = await params;
  const notice = parseNotice((await searchParams).notice);
  const access = await requireAuthor(offeringId);
  const { offering, user } = access;
  const tz = user.timezone;
  const [versions, offerings] = await Promise.all([loadCourseVersions(offering.course_id), loadCourseOfferings(offering.course_id)]);
  const current = versions.find((v) => v.id === offering.course_version_id) ?? null;
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const archived = offering.status === "archived";
  const usedBy = (versionId: string) => offerings.filter((o) => o.course_version_id === versionId);
  const base = `/courses/${offeringId}/content/manage`;
  const courseTitle = offering.courses?.title ?? offering.code;
  // Shown only when the data agrees with the notice the action redirected with.
  const latestPublished = versions
    .filter((v) => v.status === "published" && v.published_at)
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
  const noticeText =
    notice === "published" && latestPublished
      ? t("author.draft.published", { n: latestPublished.version_no })
      : notice === "adopted" && current
        ? t("author.versions.adopted", { n: current.version_no })
        : notice === "released" && offering.status === "published"
          ? t("author.offering.released")
          : null;

  return (
    <PageBody>
      <div className="mx-auto max-w-6xl space-y-6">
        <ManageHeader offeringId={offeringId} current="versions" />
        <ActionNotice message={noticeText} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel aria-labelledby="manage-in-use">
            <PanelHeader id="manage-in-use" title={t("author.inUse.title")} />
            <div className="space-y-3 px-4 py-4 sm:px-6">
              {current ? (
                <>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t("author.inUse.version", { n: current.version_no })}</span>
                    <VersionStatusBadge status={current.status} />
                  </p>
                  <p className="text-sm">{current.title}</p>
                  {current.published_at ? <p className="text-sm text-muted">{t("author.inUse.publishedOn", { date: formatDateTime(current.published_at, tz) })}</p> : null}
                  {current.status === "draft" ? <Alert tone="warning">{t("author.inUse.draftWarning")}</Alert> : null}
                  <Link href={`${base}/versions/${current.id}`} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
                    <Eye aria-hidden="true" className="h-4 w-4" /> {t("author.versions.viewNamed", { n: current.version_no })}
                  </Link>
                </>
              ) : null}
            </div>
          </Panel>

          <Panel aria-labelledby="manage-access">
            <PanelHeader
              id="manage-access"
              title={t("author.offering.title")}
              actions={
                offering.status === "published" ? (
                  <Badge tone="success">{t("author.offering.visible")}</Badge>
                ) : offering.status === "draft" ? (
                  <Badge tone="warning">{t("author.offering.hidden")}</Badge>
                ) : (
                  <Badge>{t("author.offering.archived")}</Badge>
                )
              }
            />
            <div className="space-y-3 px-4 py-4 sm:px-6">
              <p className="text-sm">
                {offering.status === "published"
                  ? t("author.offering.visibleHelp")
                  : offering.status === "draft"
                    ? t("author.offering.hiddenHelp")
                    : t("author.offering.archivedHelp")}
              </p>
              {offering.status === "draft" ? (
                current?.status === "published" ? (
                  <ConfirmForm
                    action={releaseOffering}
                    fields={{ offeringId }}
                    trigger={
                      <>
                        <Send aria-hidden="true" className="h-4 w-4" /> {t("author.offering.release")}
                      </>
                    }
                    triggerVariant="primary"
                    title={t("author.offering.releaseTitle", { code: offering.code })}
                    description={t("author.offering.releaseBody")}
                    confirmLabel={t("author.offering.release")}
                  />
                ) : (
                  <div className="space-y-1">
                    <button type="button" disabled aria-describedby="release-unavailable" className={buttonClass("primary")}>
                      <Send aria-hidden="true" className="h-4 w-4" /> {t("author.offering.release")}
                    </button>
                    <p id="release-unavailable" className="text-sm text-muted">{t("author.offering.needsPublished")}</p>
                  </div>
                )
              ) : offering.status === "published" ? (
                <p className="text-sm text-muted">{t("author.offering.cannotHide")}</p>
              ) : null}
            </div>
          </Panel>
        </div>

        <Panel aria-labelledby="manage-draft">
          <PanelHeader id="manage-draft" title={t("author.draft.title")} actions={draft ? <VersionStatusBadge status="draft" /> : null} />
          <div className="space-y-4 px-4 py-4 sm:px-6">
            {draft ? (
              <>
                <p>{t("author.draft.exists", { n: draft.version_no })}</p>
                <div className="flex flex-wrap items-start gap-2">
                  <Link href={`${base}/versions/${draft.id}`} className={buttonClass("primary")}>
                    <Pencil aria-hidden="true" className="h-4 w-4" /> {t("author.versions.edit")}
                  </Link>
                  <ConfirmForm
                    action={publishVersion}
                    fields={{ offeringId, versionId: draft.id, returnTo: "manage" }}
                    trigger={
                      <>
                        <Rocket aria-hidden="true" className="h-4 w-4" /> {t("author.draft.publish")}
                      </>
                    }
                    title={t("author.draft.publishTitle", { n: draft.version_no })}
                    description={t("author.draft.publishBody")}
                    confirmLabel={t("author.draft.publish")}
                  />
                </div>
              </>
            ) : (
              <>
                <p>{t("author.draft.none")}</p>
                <ActionForm action={createDraft}>
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <SubmitButton pendingText={t("author.draft.creating")}>
                    <FilePlus2 aria-hidden="true" className="h-4 w-4" /> {t("author.draft.create")}
                  </SubmitButton>
                </ActionForm>
              </>
            )}
            <p className="text-sm text-muted">{t("author.draft.shared", { codes: offerings.map((o) => o.code).join(", ") || offering.code })}</p>
          </div>
        </Panel>

        <section aria-labelledby="manage-versions" className="space-y-3">
          <h3 id="manage-versions" className="text-lg font-semibold">{t("author.versions.title")}</h3>
          <ScrollTable caption={t("author.versions.caption", { course: courseTitle })} captionHidden>
            <thead>
              <tr>
                <th scope="col" className={th}>{t("author.versions.col.version")}</th>
                <th scope="col" className={th}>{t("author.versions.col.status")}</th>
                <th scope="col" className={th}>{t("author.versions.col.dates")}</th>
                <th scope="col" className={th}>{t("author.versions.col.usedBy")}</th>
                <th scope="col" className={th}>{t("author.versions.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const users = usedBy(v.id);
                const isCurrent = v.id === offering.course_version_id;
                return (
                  <tr key={v.id}>
                    <th scope="row" className={`${td} font-medium`}>
                      {t("author.inUse.version", { n: v.version_no })}
                      <span className="block text-sm font-normal text-muted">{v.title}</span>
                    </th>
                    <td className={td}>
                      <VersionStatusBadge status={v.status} />
                    </td>
                    <td className={`${td} whitespace-nowrap text-sm`}>
                      <span className="block">{t("author.versions.created", { date: formatDate(v.created_at, tz) })}</span>
                      {v.published_at ? <span className="block">{t("author.versions.published", { date: formatDate(v.published_at, tz) })}</span> : null}
                    </td>
                    <td className={`${td} text-sm`}>
                      {users.length === 0 ? (
                        <span className="text-muted">{t("author.versions.notUsed")}</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1">
                          {users.map((o) => (
                            <li key={o.id}>
                              <Badge tone={o.id === offeringId ? "info" : "neutral"}>{o.id === offeringId ? `${o.code} · ${t("author.versions.thisOffering")}` : o.code}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap items-start gap-2">
                        <Link
                          href={`${base}/versions/${v.id}`}
                          className={buttonClass("secondary", "sm")}
                          aria-label={v.status === "draft" ? t("author.versions.editNamed", { n: v.version_no }) : t("author.versions.viewNamed", { n: v.version_no })}
                        >
                          {v.status === "draft" ? t("author.versions.edit") : t("author.versions.view")}
                        </Link>
                        {v.status === "published" && !isCurrent ? (
                          archived ? (
                            <span className="text-sm text-muted">{t("author.versions.archivedOffering")}</span>
                          ) : (
                            <ConfirmForm
                              action={adoptVersion}
                              fields={{ offeringId, versionId: v.id }}
                              trigger={
                                <>
                                  {t("author.versions.adopt")}
                                  <span className="sr-only">: {t("author.inUse.version", { n: v.version_no })}</span>
                                </>
                              }
                              size="sm"
                              title={t("author.versions.adoptTitle", { n: v.version_no, code: offering.code })}
                              description={t("author.versions.adoptBody", { n: v.version_no })}
                              confirmLabel={t("author.versions.adopt")}
                            />
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </ScrollTable>
        </section>
      </div>
    </PageBody>
  );
}
