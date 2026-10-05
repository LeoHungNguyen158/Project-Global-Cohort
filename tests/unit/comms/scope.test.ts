import { describe, expect, it } from "vitest";
import { composeHref, parseScopeParams, scopeMessagesHref, scopeSignature, toMessageScope } from "@/lib/comms/scope";

const ID = "ec8ca15e-b048-465a-937e-5566284ce071";

describe("parseScopeParams", () => {
  it("reads exactly one course or cohort id", () => {
    expect(parseScopeParams({})).toBeNull();
    expect(parseScopeParams({ offering: ID })).toEqual({ type: "offering", id: ID });
    expect(parseScopeParams({ cohort: ID.toUpperCase() })).toEqual({ type: "cohort", id: ID });
    expect(parseScopeParams({ offering: [ID, "x"] })).toEqual({ type: "offering", id: ID });
  });

  it("rejects malformed ids and ambiguous scopes", () => {
    expect(parseScopeParams({ offering: "not-a-uuid" })).toBe("invalid");
    expect(parseScopeParams({ offering: "" })).toBe("invalid");
    expect(parseScopeParams({ offering: ID, cohort: ID })).toBe("invalid");
    expect(parseScopeParams({ cohort: `${ID}' or 1=1` })).toBe("invalid");
  });
});

describe("message links", () => {
  it("builds the URL contract links", () => {
    expect(scopeMessagesHref({ type: "offering", id: ID })).toBe(`/messages?offering=${ID}`);
    expect(composeHref({ type: "cohort", id: ID })).toBe(`/messages/new?cohort=${ID}`);
    expect(composeHref({ type: "offering", id: ID }, ID)).toBe(`/messages/new?offering=${ID}&to=${ID}`);
    // A recipient that is not an id is dropped rather than echoed into the URL.
    expect(composeHref({ type: "offering", id: ID }, "<script>")).toBe(`/messages/new?offering=${ID}`);
  });
});

describe("toMessageScope", () => {
  it("normalizes RPC rows and guards the accent color", () => {
    const s = toMessageScope({ scope_type: "cohort", scope_id: ID, code: "GC", title: "Cohort", accent_color: "red;background:url(x)", unread: null, thread_count: 2 });
    expect(s).toEqual({ type: "cohort", id: ID, code: "GC", title: "Cohort", accent: "#475569", unread: 0, threads: 2 });
    expect(toMessageScope({ scope_type: "offering", scope_id: ID, code: "A", title: "T", accent_color: "#2563EB", unread: 3, thread_count: 1 }).accent).toBe("#2563EB");
  });
});

describe("scopeSignature", () => {
  it("is order independent and changes when counts change", () => {
    const a = { type: "offering", id: "a", unread: 1, threads: 2 };
    const b = { type: "cohort", id: "b", unread: 0, threads: 1 };
    expect(scopeSignature(1, [a, b])).toBe(scopeSignature(1, [b, a]));
    expect(scopeSignature(1, [a, b])).not.toBe(scopeSignature(2, [{ ...a, unread: 2 }, b]));
    expect(scopeSignature(1, [a, b])).not.toBe(scopeSignature(1, [a, { ...b, threads: 2 }]));
  });
});
