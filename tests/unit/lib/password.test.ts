import { describe, expect, it } from "vitest";
import { passwordProblem } from "@/lib/password";

describe("password strength rules", () => {
  it("accepts 10 to 200 characters with a letter and a digit", () => {
    expect(passwordProblem("abcdefghi1")).toBeNull();
    expect(passwordProblem(`${"a".repeat(199)}1`)).toBeNull();
  });
  it("names the first rule a password breaks", () => {
    expect(passwordProblem("abc1")).toBe("tooShort");
    expect(passwordProblem(`${"a".repeat(200)}1`)).toBe("tooLong");
    expect(passwordProblem("1234567890")).toBe("letter");
    expect(passwordProblem("abcdefghij")).toBe("number");
  });
});
