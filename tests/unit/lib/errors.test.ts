import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/errors";

describe("friendlyError", () => {
  it("never shows raw permission or row-level security messages", () => {
    expect(friendlyError({ code: "42501", message: "permission denied for table grades" })).toBe("You do not have permission to do that.");
    expect(friendlyError({ code: "42501", message: 'new row violates row-level security policy for table "grades"' })).toBe(
      "You do not have permission to do that.",
    );
    expect(friendlyError({ message: "new row violates row-level security policy" })).toBe("You do not have permission to do that.");
  });

  it("passes through deliberate user-facing messages", () => {
    expect(friendlyError({ code: "42501", message: "Not authorized to author this course" })).toBe("Not authorized to author this course");
    expect(friendlyError({ code: "P0001", message: "This invitation was revoked" })).toBe("This invitation was revoked");
    expect(friendlyError({ code: "P0428", message: "Confirm sending to 40 people" })).toBe("Confirm sending to 40 people");
  });

  it("maps constraint and rate-limit errors to plain language", () => {
    expect(friendlyError({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe("That already exists.");
    expect(friendlyError({ code: "23514", message: "check constraint" })).toMatch(/not valid/);
    expect(friendlyError({ code: "P0429", message: "rate limited" })).toMatch(/Too many requests/);
  });

  it("falls back for unknown errors without leaking internals", () => {
    expect(friendlyError({ code: "XX000", message: "internal: relation private.answer_keys" }, "Could not save.")).toBe("Could not save.");
    expect(friendlyError(null)).toBe("Something went wrong. Please try again.");
  });
});
