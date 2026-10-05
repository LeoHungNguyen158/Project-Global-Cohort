// Discussion threading and pagination. Posts arrive flat from comms_topic_posts()
// (one page of top-level posts plus every reply beneath them) and are nested here.
import { compareTimestamps } from "./timestamps";

export type PostRow = {
  id: string;
  parent_id: string | null;
  root_id?: string | null;
  author_id: string;
  author_name: string | null;
  body_html: string;
  created_at: string;
  edited_at: string | null;
  hidden_at: string | null;
  hidden_reason: string | null;
  revision_count: number;
};

export type PostNode = PostRow & { depth: number; parentAuthor: string | null; replies: PostNode[] };

/** Replies deeper than this are drawn at this indentation, labeled "In reply to …". */
export const MAX_INDENT_DEPTH = 2;
export const TOPICS_PAGE_SIZE = 20;
export const POSTS_PAGE_SIZE = 15;

function byTime(a: PostRow, b: PostRow): number {
  return compareTimestamps(a.created_at, b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Builds the reply tree. Posts whose parent is not in the set (which should not
 * happen) are shown as top-level posts rather than dropped.
 */
export function buildPostTree(rows: PostRow[]): PostNode[] {
  const nodes = new Map<string, PostNode>();
  for (const r of rows) nodes.set(r.id, { ...r, depth: 0, parentAuthor: null, replies: [] });
  const roots: PostNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent && parent !== node) parent.replies.push(node);
    else roots.push(node);
  }
  const visit = (list: PostNode[], depth: number, parentAuthor: string | null, seen: Set<string>) => {
    list.sort(byTime);
    for (const n of list) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      n.depth = depth;
      n.parentAuthor = parentAuthor;
      visit(n.replies, depth + 1, n.author_name, seen);
    }
  };
  visit(roots, 0, null, new Set());
  return roots;
}

/** Pre-order list (each post followed by its replies), for rendering with indentation. */
export function flattenPosts(tree: PostNode[]): PostNode[] {
  const out: PostNode[] = [];
  const walk = (list: PostNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.replies);
    }
  };
  walk(tree);
  return out;
}

export function countPosts(tree: PostNode[]): number {
  return flattenPosts(tree).length;
}

/** Number of pages and the requested page clamped into range (1-based). */
export function pageInfo(total: number, pageSize: number, requested: unknown): { page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(Math.max(total, 0) / Math.max(pageSize, 1)));
  const n = typeof requested === "string" ? Number.parseInt(requested, 10) : typeof requested === "number" ? requested : NaN;
  const page = Number.isFinite(n) ? Math.min(Math.max(1, Math.trunc(n)), pages) : 1;
  return { page, pages };
}

/** Reads a 1-based page number from a search param (anything invalid means page 1). */
export function readPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1;
}
