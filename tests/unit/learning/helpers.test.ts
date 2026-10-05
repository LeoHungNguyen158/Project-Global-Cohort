import { describe, expect, it } from "vitest";
import { compareNames, foldText, matchesQuery } from "@/lib/learning/search";
import { moveItem, positionChanges } from "@/lib/learning/reorder";
import { parseDurationMinutes, parseObjectives, parseScorePercent } from "@/lib/learning/validate";
import { assetKind, describeFileType, isCaptionLanguage, languageLabel, roleProblem } from "@/lib/learning/assets";

describe("name search (Vietnamese and accented names)", () => {
  it("matches without accents or case", () => {
    expect(foldText("Nguyễn Văn An")).toBe("nguyen van an");
    expect(foldText("Đặng Quốc Huy")).toBe("dang quoc huy");
    expect(matchesQuery("Nguyễn Văn An", "nguyen an")).toBe(true);
    expect(matchesQuery("Đặng Quốc Huy", "dang")).toBe(true);
    expect(matchesQuery("Lê Thị Bình", "binh")).toBe(true);
    expect(matchesQuery("Lê Thị Bình", "an")).toBe(false);
    expect(matchesQuery("Sofia Ramirez", "")).toBe(true);
  });
  it("sorts with locale rules", () => {
    expect(["Đặng", "Bình", "An"].sort(compareNames)).toEqual(["An", "Bình", "Đặng"]);
  });
});

describe("keyboard reordering", () => {
  it("moves one step and reports which positions changed", () => {
    expect(moveItem(["a", "b", "c"], "c", "up")).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], "a", "down")).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "a", "up")).toBeNull();
    expect(moveItem(["a", "b", "c"], "c", "down")).toBeNull();
    expect(moveItem(["a"], "x", "up")).toBeNull();
    const rows = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 5 }];
    expect(positionChanges(rows, ["a", "c", "b"])).toEqual([{ id: "c", position: 1 }, { id: "b", position: 2 }]);
  });
});

describe("authoring input", () => {
  it("parses objectives one per line", () => {
    expect(parseObjectives("- Explain loops\n\n2. Apply tools\n* Evaluate  ")).toEqual({ ok: true, value: ["Explain loops", "Apply tools", "Evaluate"] });
    expect(parseObjectives(Array.from({ length: 21 }, (_, i) => `o${i}`).join("\n"))).toEqual({ ok: false, reason: "too_many" });
    expect(parseObjectives("x".repeat(301))).toEqual({ ok: false, reason: "too_long" });
  });
  it("validates durations and scores", () => {
    expect(parseDurationMinutes("")).toBeNull();
    expect(parseDurationMinutes("45")).toBe(45);
    expect(parseDurationMinutes("4.5")).toBe("invalid");
    expect(parseDurationMinutes("10001")).toBe("invalid");
    expect(parseScorePercent("70")).toBe(70);
    expect(parseScorePercent("72.5")).toBe(72.5);
    expect(parseScorePercent("101")).toBe("invalid");
    expect(parseScorePercent("-1")).toBe("invalid");
  });
});

describe("lesson files", () => {
  it("classifies types and checks roles", () => {
    expect(assetKind("video/webm")).toBe("video");
    expect(assetKind("text/vtt")).toBe("captions");
    expect(describeFileType("text/plain", "starter_agent_loop.py")).toBe("Text file (.py)");
    expect(describeFileType("application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx")).toBe("PowerPoint presentation (.pptx)");
    expect(roleProblem("captions", "text/vtt")).toBeNull();
    expect(roleProblem("captions", "video/mp4")).not.toBeNull();
    expect(roleProblem("primary", "application/pdf")).toBeNull();
    expect(roleProblem("primary", "text/plain")).not.toBeNull();
    expect(roleProblem("attachment", "text/plain")).toBeNull();
  });
  it("accepts caption languages the database accepts", () => {
    expect(isCaptionLanguage("en")).toBe(true);
    expect(isCaptionLanguage("pt-BR")).toBe(true);
    expect(isCaptionLanguage("EN")).toBe(false);
    expect(isCaptionLanguage("english")).toBe(false);
    expect(languageLabel("vi")).toBe("Vietnamese");
  });
});
