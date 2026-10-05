import { ExternalLink, Mail } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { t } from "@/i18n";
import { tx } from "./rich-t";
import type { SiteSettings } from "./site-settings";

/**
 * The configured program support contact. When none is configured, says so plainly
 * (an explicit setup item) instead of showing an invented address.
 */
export function SupportContact({ settings }: { settings: SiteSettings | null }) {
  if (!settings) return <Alert tone="warning">{t("help.contact.loadError")}</Alert>;
  const { supportEmail, supportUrl } = settings;
  if (!supportEmail && !supportUrl) {
    return (
      <Alert tone="warning" title={t("help.contact.notConfiguredTitle")}>
        <p>{t("help.contact.notConfigured")}</p>
      </Alert>
    );
  }
  return (
    <ul className="space-y-2" data-testid="support-contact">
      {supportEmail ? (
        <li className="flex items-center gap-2">
          <Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 break-words">
            {tx("help.contact.email", {
              email: (
                <a className="text-primary underline" href={`mailto:${supportEmail}`}>
                  {supportEmail}
                </a>
              ),
            })}
          </span>
        </li>
      ) : null}
      {supportUrl ? (
        <li className="flex items-center gap-2">
          <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 break-all">
            {tx("help.contact.url", {
              url: (
                <a className="text-primary underline" href={supportUrl} target="_blank" rel="noopener noreferrer">
                  {supportUrl}
                  <span className="sr-only"> {t("tools.opensNewTab")}</span>
                </a>
              ),
            })}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
