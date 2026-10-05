import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { getAssignment } from "@/lib/assessment/assignment-data";
import { updateAssignment } from "@/app/actions/assignments";
import { AssignmentFields } from "@/components/assessment/assignment-fields";
import { PublicationBadge, RoleNotice } from "@/components/assessment/badges";
import { SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { t } from "@/i18n";

type Params = { offeringId: string; assignmentId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, assignmentId } = await params;
  const a = await getAssignment(offeringId, assignmentId);
  return { title: a ? t("assign.author.editTitle", { title: a.title }) : t("assign.title") };
}

export default async function EditAssignmentPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ created?: string }> }) {
  const { offeringId, assignmentId } = await params;
  const { created } = await searchParams;
  const access = await requireOffering(offeringId);
  if (!access.canAuthor) notFound();
  const assignment = await getAssignment(offeringId, assignmentId);
  if (!assignment) notFound();

  const supabase = await createClient();
  const [gradedRes, submittedRes] = await Promise.all([
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("assignment_id", assignment.id).eq("status", "graded"),
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("assignment_id", assignment.id).neq("status", "draft"),
  ]);
  const gradedCount = gradedRes.count ?? 0;
  const submittedCount = submittedRes.count ?? 0;
  const base = `/courses/${offeringId}/assignments/${assignment.id}`;

  return (
    <PageBody className="space-y-4">
      <div>
        <Link href={`/courses/${offeringId}/assignments`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("assign.backToAssignments")}
        </Link>
        <div className="mt-2">
          <SectionHeading
            actions={
              <>
                <RoleNotice>{t("assign.authoringBadge")}</RoleNotice>
                <PublicationBadge status={assignment.status} />
              </>
            }
          >
            {t("assign.author.editTitle", { title: assignment.title })}
          </SectionHeading>
        </div>
        <div className="-mt-2 flex flex-wrap gap-2">
          <ButtonLink href={base} size="sm" variant="secondary">{t("assign.author.viewPage")}</ButtonLink>
          {access.canGrade ? <ButtonLink href={`${base}/grade`} size="sm" variant="secondary">{t("assign.list.grade")}</ButtonLink> : null}
        </div>
      </div>

      {created === "1" ? (
        <Alert tone="success" live>
          {assignment.status === "draft" ? t("assign.author.createdDraftNotice") : t("assign.author.createdNotice")}
        </Alert>
      ) : null}
      {submittedCount > 0 ? <p className="text-sm text-muted">{t("assign.author.submittedCount", { count: submittedCount })}</p> : null}
      {gradedCount > 0 ? <Alert tone="warning">{t("assign.author.gradedWarning", { count: gradedCount })}</Alert> : null}

      <Panel className="px-4 py-5 sm:px-6">
        <ActionForm action={updateAssignment}>
          <input type="hidden" name="assignment_id" value={assignment.id} />
          <AssignmentFields assignment={assignment} tz={access.user.timezone} />
          <div className="mt-6">
            <SubmitButton pendingText={t("assign.author.saving")}>{t("assign.author.save")}</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
    </PageBody>
  );
}
