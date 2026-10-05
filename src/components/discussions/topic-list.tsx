import Link from "next/link";
import { Lock, MessagesSquare, Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";
import type { TopicSummary } from "@/lib/comms/discussion-queries";
import { topicPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

/** Topics with post counts, last activity (viewer's zone) and pinned/locked state. */
export function TopicList({ topics, scope, tz, headingLevel = 3 }: { topics: TopicSummary[]; scope: DiscussionScope; tz: string; headingLevel?: 3 | 4 }) {
  const H = headingLevel === 3 ? "h3" : "h4";
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-panel">
      {topics.map((topic) => {
        const posts = topic.post_count === 0 ? t("disc.postsNone") : topic.post_count === 1 ? t("disc.postsOne") : t("disc.posts", { count: topic.post_count });
        return (
          <li key={topic.id} className="flex gap-3 px-4 py-3 sm:px-6">
            <MessagesSquare aria-hidden="true" className="mt-1 hidden h-5 w-5 shrink-0 text-muted sm:block" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <H className="min-w-0 break-words font-semibold">
                  <Link href={topicPath(scope, topic.id)} className="hover:underline">
                    {topic.title}
                  </Link>
                </H>
                {topic.pinned ? (
                  <Badge tone="info">
                    <Pin aria-hidden="true" className="h-3 w-3" /> {t("disc.pinned")}
                  </Badge>
                ) : null}
                {topic.locked ? (
                  <Badge tone="warning">
                    <Lock aria-hidden="true" className="h-3 w-3" /> {t("disc.locked")}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted">
                {topic.author_name ? <span>{t("disc.startedBy", { name: topic.author_name })}</span> : null}
                {topic.author_name ? <span aria-hidden="true">·</span> : null}
                <span>{posts}</span>
                <span aria-hidden="true">·</span>
                <span>
                  <time dateTime={topic.last_activity_at}>{t("disc.lastActivity", { time: formatDateTime(topic.last_activity_at, tz) })}</time>
                </span>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
