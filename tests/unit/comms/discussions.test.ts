import { describe, expect, it } from "vitest";
import { buildPostTree, countPosts, flattenPosts, pageInfo, readPage, type PostRow } from "@/lib/comms/discussions";

const post = (id: string, parent: string | null, at: string, author = id.toUpperCase()): PostRow => ({
  id, parent_id: parent, author_id: author, author_name: author, body_html: `<p>${id}</p>`, created_at: at,
  edited_at: null, hidden_at: null, hidden_reason: null, revision_count: 0,
});

describe("buildPostTree", () => {
  it("nests replies under their parents in time order with depth and parent author", () => {
    const rows = [
      post("r2", "a", "2026-10-05T03:00:00Z"),
      post("a", null, "2026-10-05T01:00:00Z"),
      post("b", null, "2026-10-05T02:00:00Z"),
      post("r1", "a", "2026-10-05T02:30:00Z"),
      post("rr", "r1", "2026-10-05T04:00:00Z"),
    ];
    const tree = buildPostTree(rows);
    expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
    const flat = flattenPosts(tree);
    expect(flat.map((n) => `${n.id}:${n.depth}`)).toEqual(["a:0", "r1:1", "rr:2", "r2:1", "b:0"]);
    expect(flat.find((n) => n.id === "rr")?.parentAuthor).toBe("R1");
    expect(countPosts(tree)).toBe(5);
  });

  it("keeps orphaned replies visible as top-level posts", () => {
    const tree = buildPostTree([post("x", "missing", "2026-10-05T01:00:00Z")]);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });
});

describe("pagination", () => {
  it("clamps pages into range", () => {
    expect(pageInfo(0, 20, "1")).toEqual({ page: 1, pages: 1 });
    expect(pageInfo(45, 20, "3")).toEqual({ page: 3, pages: 3 });
    expect(pageInfo(45, 20, "9")).toEqual({ page: 3, pages: 3 });
    expect(pageInfo(45, 20, "-2")).toEqual({ page: 1, pages: 3 });
    expect(pageInfo(45, 20, "abc")).toEqual({ page: 1, pages: 3 });
  });

  it("reads page numbers defensively", () => {
    expect(readPage(undefined)).toBe(1);
    expect(readPage("2")).toBe(2);
    expect(readPage(["4", "5"])).toBe(4);
    expect(readPage("0")).toBe(1);
    expect(readPage("1e9")).toBe(1);
  });
});
