import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { requireAuthor } from "@/lib/learning/authoring";
import { createClient } from "@/lib/supabase/server";
import { describeRule } from "@/lib/domain/prerequisites";
import { flattenLessons } from "@/lib/learning/outline";
import { loadCourseVersions, loadOutline, loadQuizzes, loadRules, loadVersionStructure } from "@/lib/learning/data";
import { formatDateTime } from "@/lib/time";
import { addLessonRule, addQuizRule, addReleaseRule, removeRule } from "@/app/actions/learning";
import { ManageHeader } from "@/components/learning/authoring/manage-header";
import { ActionNotice } from "@/components/learning/authoring/action-notice";
import { parseNotice } from "@/lib/learning/notices";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input, Select } from "@/components/ui/field";
import { DateTimeField } from "@/components/ui/datetime-field";
import { EmptyState } from "@/components/ui/empty-state";
import { td, th } from "@/components/ui/table";
import { ScrollTable } from "@/components/learning/scroll-table";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("author.rules.title") };

type OverrideRow = {
  id: string;
  user_id: string;
  target_lesson_lineage: string;
  reason: string;
  created_at: string;
  revoked_at: string | null;
  learner: { display_name: string } | null;
  granter: { display_name: string } | null;
};

const QUIZ_STATUS = { draft: "author.status.draft", published: "author.status.published", archived: "author.status.archived" } as const;

export default async function RulesPage({ params, searchParams }: { params: Promise<{ offeringId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { offeringId } = await params;
  const notice = parseNotice((await searchParams).notice);
  const access = await requireAuthor(offeringId);
  const { offering, user } = access;
  const tz = user.timezone;
  const archived = offering.status === "archived";
  const supabase = await createClient();

  const [{ outline }, rules, quizzes, versions, overridesRes] = await Promise.all([
    loadOutline(offeringId),
    loadRules(offeringId),
    loadQuizzes(offeringId),
    loadCourseVersions(offering.course_id),
    supabase
      .from("prerequisite_overrides")
      .select(
        "id, user_id, target_lesson_lineage, reason, created_at, revoked_at, learner:profiles!prerequisite_overrides_user_id_fkey(display_name), granter:profiles!prerequisite_overrides_granted_by_fkey(display_name)",
      )
      .eq("offering_id", offeringId)
      .order("created_at", { ascending: false }),
  ]);
  const overrides = (overridesRes.data ?? []) as unknown as OverrideRow[];

  // Lessons that conditions can target: the version this offering uses, plus lessons that
  // so far exist only in the course's draft (so rules can be prepared before adopting it).
  const adopted = flattenLessons(outline.modules);
  const titles = new Map(adopted.map(({ lesson }) => [lesson.lineage_id, lesson.title]));
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const draftOnly: { lineage: string; title: string }[] = [];
  if (draft && draft.id !== offering.course_version_id) {
    for (const m of await loadVersionStructure(draft.id)) {
      for (const l of m.lessons) {
        if (!titles.has(l.lineage_id)) draftOnly.push({ lineage: l.lineage_id, title: l.title });
      }
    }
  }
  const draftTitles = new Map(draftOnly.map((d) => [d.lineage, d.title]));
  const quizTitles = new Map(quizzes.map((q) => [q.id, q.title]));
  const describe = (rule: (typeof rules)[number]) =>
    describeRule(rule, {
      tz,
      courseTz: offering.timezone,
      lessonTitle: (lineage) => titles.get(lineage) ?? (draftTitles.has(lineage) ? t("author.rules.draftOnly", { title: draftTitles.get(lineage)!, n: draft?.version_no ?? "" }) : null),
      quizTitle: (id) => quizTitles.get(id) ?? null,
    });
  const lessonLabel = (lineage: string) =>
    titles.get(lineage) ?? (draftTitles.has(lineage) ? t("author.rules.draftOnly", { title: draftTitles.get(lineage)!, n: draft?.version_no ?? "" }) : t("learn.lock.previousLesson"));
  const options = (
    <>
      {outline.modules.map((m, i) => (
        <optgroup key={m.id} label={`${t("learn.content.module", { n: i + 1 })}: ${m.title}`}>
          {m.lessons.map((l) => (
            <option key={l.lineage_id} value={l.lineage_id}>{l.title}</option>
          ))}
        </optgroup>
      ))}
      {draftOnly.length > 0 ? (
        <optgroup label={t("author.rules.draftGroup", { n: draft?.version_no ?? "" })}>
          {draftOnly.map((d) => (
            <option key={d.lineage} value={d.lineage}>{t("author.rules.draftOnly", { title: d.title, n: draft?.version_no ?? "" })}</option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
  const knownTargets = new Set([...titles.keys(), ...draftTitles.keys()]);
  const otherRules = rules.filter((r) => !titles.has(r.target_lesson_lineage));
  const hasLessons = adopted.length + draftOnly.length > 0;

  const removeButton = (rule: (typeof rules)[number], label: string) =>
    archived ? null : (
      <ConfirmForm
        action={removeRule}
        fields={{ offeringId, ruleId: rule.id }}
        trigger={
          <>
            <Trash2 aria-hidden="true" className="h-4 w-4" /> {t("author.rules.remove")}
            <span className="sr-only">: {label}</span>
          </>
        }
        triggerVariant="ghost"
        size="sm"
        tone="danger"
        title={t("author.rules.removeTitle")}
        description={t("author.rules.removeBody")}
        confirmLabel={t("author.rules.remove")}
      />
    );

  return (
    <PageBody>
      <div className="mx-auto max-w-6xl space-y-6">
        <ManageHeader offeringId={offeringId} current="rules" intro={false} />
        <ActionNotice message={notice === "ruleRemoved" ? t("author.rules.removed") : null} />
        <p className="max-w-3xl text-sm">{t("author.rules.intro")}</p>
        {archived ? <Alert tone="info">{t("author.rules.archived")}</Alert> : null}

        <section aria-labelledby="rules-by-lesson" className="space-y-3">
          <h3 id="rules-by-lesson" className="text-lg font-semibold">{t("author.rules.byLesson")}</h3>
          {adopted.length === 0 ? <EmptyState title={t("author.rules.noLessons")} /> : null}
          <ol className="space-y-4">
            {outline.modules.map((m, i) => (
              <li key={m.id}>
                <section aria-labelledby={`rules-module-${m.id}`} className="rounded-[var(--radius-panel)] border border-line bg-panel">
                  <h4 id={`rules-module-${m.id}`} className="border-b border-line px-4 py-3 font-semibold sm:px-6">
                    {t("learn.content.module", { n: i + 1 })}: {m.title}
                  </h4>
                  <ul className="divide-y divide-line">
                    {m.lessons.map((l) => {
                      const lessonRules = rules.filter((r) => r.target_lesson_lineage === l.lineage_id);
                      return (
                        <li key={l.id} className="px-4 py-3 sm:px-6">
                          <p className="break-words font-medium">{l.title}</p>
                          {lessonRules.length === 0 ? (
                            <p className="text-sm text-muted">{t("author.rules.none")}</p>
                          ) : (
                            <ul className="mt-1 space-y-1">
                              {lessonRules.map((r) => {
                                const text = describe(r);
                                return (
                                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                    <span className="min-w-0 break-words">{text}</span>
                                    {removeButton(r, text)}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </li>
            ))}
          </ol>
          {otherRules.length > 0 ? (
            <Panel aria-labelledby="rules-other">
              <PanelHeader id="rules-other" title={t("author.rules.otherTitle")} level={3} />
              <ul className="divide-y divide-line">
                {otherRules.map((r) => {
                  const text = `${knownTargets.has(r.target_lesson_lineage) ? lessonLabel(r.target_lesson_lineage) : t("author.rules.unknownTarget")}: ${describe(r)}`;
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-6">
                      <span className="min-w-0 break-words">{text}</span>
                      {removeButton(r, text)}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </section>

        {!archived && hasLessons ? (
          <section aria-labelledby="rules-add" className="space-y-3">
            <h3 id="rules-add" className="text-lg font-semibold">{t("author.rules.addTitle")}</h3>
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel aria-labelledby="rule-lesson">
                <PanelHeader id="rule-lesson" title={t("author.rules.addLesson")} level={3} />
                <ActionForm action={addLessonRule} className="space-y-3 px-4 py-4 sm:px-6">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <Field label={t("author.rules.target")} htmlFor="rl-target" required>
                    <Select id="rl-target" name="target" required defaultValue="">
                      <option value="" disabled>{t("author.rules.choose")}</option>
                      {options}
                    </Select>
                  </Field>
                  <Field label={t("author.rules.required")} htmlFor="rl-required" required>
                    <Select id="rl-required" name="required" required defaultValue="">
                      <option value="" disabled>{t("author.rules.choose")}</option>
                      {options}
                    </Select>
                  </Field>
                  <SubmitButton variant="secondary">
                    <Plus aria-hidden="true" className="h-4 w-4" /> {t("author.rules.add")}
                  </SubmitButton>
                </ActionForm>
              </Panel>

              <Panel aria-labelledby="rule-quiz">
                <PanelHeader id="rule-quiz" title={t("author.rules.addQuiz")} level={3} />
                {quizzes.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted sm:px-6">{t("author.rules.noQuizzes")}</p>
                ) : (
                  <ActionForm action={addQuizRule} className="space-y-3 px-4 py-4 sm:px-6">
                    <input type="hidden" name="offeringId" value={offeringId} />
                    <Field label={t("author.rules.target")} htmlFor="rq-target" required>
                      <Select id="rq-target" name="target" required defaultValue="">
                        <option value="" disabled>{t("author.rules.choose")}</option>
                        {options}
                      </Select>
                    </Field>
                    <Field label={t("author.rules.quiz")} htmlFor="rq-quiz" required>
                      <Select id="rq-quiz" name="quizId" required defaultValue="">
                        <option value="" disabled>{t("author.rules.choose")}</option>
                        {quizzes.map((q) => (
                          <option key={q.id} value={q.id}>{t("author.rules.quizStatus", { title: q.title, status: t(QUIZ_STATUS[q.status]) })}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("author.rules.minScore")} htmlFor="rq-score" hint={t("author.rules.minScoreHint")} required>
                      <Input id="rq-score" name="minScore" type="number" min={0} max={100} step={0.01} inputMode="decimal" required aria-describedby="rq-score-hint" />
                    </Field>
                    <SubmitButton variant="secondary">
                      <Plus aria-hidden="true" className="h-4 w-4" /> {t("author.rules.add")}
                    </SubmitButton>
                  </ActionForm>
                )}
              </Panel>

              <Panel aria-labelledby="rule-release">
                <PanelHeader id="rule-release" title={t("author.rules.addRelease")} level={3} />
                <ActionForm action={addReleaseRule} className="space-y-3 px-4 py-4 sm:px-6">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <Field label={t("author.rules.target")} htmlFor="rr-target" required>
                    <Select id="rr-target" name="target" required defaultValue="">
                      <option value="" disabled>{t("author.rules.choose")}</option>
                      {options}
                    </Select>
                  </Field>
                  <DateTimeField name="releaseAt" label={t("author.rules.releaseAt")} tz={offering.timezone} hint={t("author.rules.releaseHint")} required />
                  <SubmitButton variant="secondary">
                    <Plus aria-hidden="true" className="h-4 w-4" /> {t("author.rules.add")}
                  </SubmitButton>
                </ActionForm>
              </Panel>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="rules-overrides" className="space-y-3">
          <h3 id="rules-overrides" className="text-lg font-semibold">{t("author.rules.overridesTitle")}</h3>
          <p className="text-sm text-muted">
            {t("author.rules.overridesHelp")}{" "}
            <Link href={`/courses/${offeringId}/people`} className="font-medium text-primary underline underline-offset-2">{t("learn.staff.peopleProgress")}</Link>
          </p>
          {overrides.length === 0 ? (
            <EmptyState title={t("author.rules.noOverrides")} />
          ) : (
            <ScrollTable caption={t("author.rules.overridesCaption")}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("author.rules.col.learner")}</th>
                  <th scope="col" className={th}>{t("author.rules.col.lesson")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.reason")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.grantedBy")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.state")}</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id}>
                    <th scope="row" className={`${td} font-medium`}>
                      <Link href={`/courses/${offeringId}/people/${o.user_id}`} className="text-primary underline underline-offset-2">
                        {o.learner?.display_name ?? t("people.unknown")}
                      </Link>
                    </th>
                    <td className={td}>{lessonLabel(o.target_lesson_lineage)}</td>
                    <td className={`${td} max-w-xs whitespace-pre-line break-words`}>{o.reason}</td>
                    <td className={`${td} text-sm`}>{t("people.detail.grantedBy", { name: o.granter?.display_name ?? t("people.unknown"), date: formatDateTime(o.created_at, tz) })}</td>
                    <td className={td}>
                      {o.revoked_at ? (
                        <Badge>{t("people.detail.statusRevoked", { date: formatDateTime(o.revoked_at, tz) })}</Badge>
                      ) : (
                        <Badge tone="success">{t("people.detail.statusActive")}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          )}
        </section>
      </div>
    </PageBody>
  );
}
