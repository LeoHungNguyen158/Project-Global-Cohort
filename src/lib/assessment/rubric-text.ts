import { t } from "@/i18n/client/assessment";
import type { RubricProblem } from "./rubric";

/** The message for a rubric validation problem (shared by the editor and the server action). */
export function rubricProblemText(p: RubricProblem): string {
  switch (p.code) {
    case "tooMany":
      return t("assign.author.err.rubric.tooMany");
    case "criterionText":
      return t("assign.author.err.rubric.criterionText", { number: p.index + 1 });
    case "criterionPoints":
      return t("assign.author.err.rubric.criterionPoints", { number: p.index + 1 });
    case "levelLabel":
      return t("assign.author.err.rubric.levelLabel", { number: p.index + 1, level: p.level + 1 });
    case "levelPoints":
      return t("assign.author.err.rubric.levelPoints", { number: p.index + 1, level: p.level + 1 });
    case "tooManyLevels":
      return t("assign.author.err.rubric.tooManyLevels", { number: p.index + 1 });
    case "duplicateId":
      return t("assign.author.err.rubric.duplicateId");
    case "totalMismatch":
      return t("assign.author.err.rubric.totalMismatch", { total: p.total, points: p.points });
  }
}
