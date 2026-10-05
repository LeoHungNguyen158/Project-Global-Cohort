import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n";

export function CohortStatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge tone="success">{t("cohort.status.active")}</Badge>;
  if (status === "upcoming") return <Badge tone="info">{t("cohort.status.upcoming")}</Badge>;
  if (status === "archived") return <Badge>{t("cohort.status.archived")}</Badge>;
  return <Badge>{status}</Badge>;
}
