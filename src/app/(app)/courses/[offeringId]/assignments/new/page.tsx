import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { createAssignment } from "@/app/actions/assignments";
import { AssignmentFields } from "@/components/assessment/assignment-fields";
import { RoleNotice } from "@/components/assessment/badges";
import { SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("assign.author.newTitle") };

export default async function NewAssignmentPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  if (!access.canAuthor) notFound();
  return (
    <PageBody className="space-y-4">
      <div>
        <Link href={`/courses/${offeringId}/assignments`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("assign.backToAssignments")}
        </Link>
        <div className="mt-2">
          <SectionHeading actions={<RoleNotice>{t("assign.authoringBadge")}</RoleNotice>}>{t("assign.author.newTitle")}</SectionHeading>
        </div>
        <p className="-mt-2 text-sm text-muted">{t("assign.author.newIntro")}</p>
      </div>
      <Panel className="px-4 py-5 sm:px-6">
        <ActionForm action={createAssignment}>
          <input type="hidden" name="offering_id" value={offeringId} />
          <AssignmentFields tz={access.user.timezone} />
          <div className="mt-6">
            <SubmitButton pendingText={t("assign.author.creating")}>{t("assign.author.create")}</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
    </PageBody>
  );
}
