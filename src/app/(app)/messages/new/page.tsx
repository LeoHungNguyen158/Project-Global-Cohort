import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { ScopeRow } from "@/components/messages/scope-row";
import { Composer } from "@/components/messages/composer";
import { loadMessageScopes, loadRecipients } from "@/lib/comms/queries";
import { allowedSelection } from "@/lib/comms/recipients";
import { parseScopeParams, sameScope, scopeMessagesHref } from "@/lib/comms/scope";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("msg.composeTitle") };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NewMessagePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  await requireUser("/messages/new");
  const scope = parseScopeParams(sp);
  if (scope === "invalid") notFound();
  const scopes = await loadMessageScopes();

  if (!scope) {
    const courses = scopes.filter((s) => s.type === "offering");
    const cohorts = scopes.filter((s) => s.type === "cohort");
    return (
      <>
        <PageHeader
          title={t("msg.composeTitle")}
          crumbs={[{ label: t("msg.title"), href: "/messages" }, { label: t("msg.composeTitle") }]}
          description={t("msg.chooseScopeHelp")}
        />
        <PageBody className="space-y-8">
          {scopes.length === 0 ? <EmptyState title={t("msg.noScopes")}>{t("msg.noScopesHelp")}</EmptyState> : null}
          {[
            { key: "courses", title: t("msg.coursesHeading"), list: courses },
            { key: "cohorts", title: t("msg.cohortsHeading"), list: cohorts },
          ]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <section key={g.key} aria-labelledby={`${g.key}-heading`} className="space-y-3">
                <h2 id={`${g.key}-heading`} className="text-lg font-semibold">{g.title}</h2>
                <ul className="space-y-3">
                  {g.list.map((s) => (
                    <ScopeRow key={`${s.type}:${s.id}`} scope={s} compose />
                  ))}
                </ul>
              </section>
            ))}
        </PageBody>
      </>
    );
  }

  // Only courses and cohorts where the viewer may send messages can be addressed;
  // anything else is reported as not found without revealing whether it exists.
  const active = scopes.find((s) => sameScope(s, scope));
  if (!active) notFound();
  const recipients = await loadRecipients(active);
  if (!recipients) notFound();
  const requested = ([] as string[]).concat(sp.to ?? []);
  const initialSelection = allowedSelection(recipients, requested);

  return (
    <>
      <PageHeader
        title={t("msg.composeTitle")}
        crumbs={[
          { label: t("msg.title"), href: "/messages" },
          { label: active.code, href: scopeMessagesHref(active) },
          { label: t("msg.composeTitle") },
        ]}
        description={t("msg.composeIn", { code: active.code, title: active.title })}
      />
      <PageBody>
        <Panel className="max-w-3xl px-4 py-5 sm:px-6">
          <Composer
            scope={{ type: active.type, id: active.id, code: active.code, title: active.title }}
            recipients={recipients}
            initialSelection={initialSelection}
            cancelHref={scopeMessagesHref(active)}
          />
        </Panel>
      </PageBody>
    </>
  );
}
