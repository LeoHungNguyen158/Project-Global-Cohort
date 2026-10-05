export type LessonRule = { target: string; required: string };

/** True if adding target -> required would create a dependency cycle. */
export function wouldCreateCycle(rules: LessonRule[], candidate: LessonRule): boolean {
  if (candidate.target === candidate.required) return true;
  const deps = new Map<string, string[]>();
  for (const r of rules) deps.set(r.target, [...(deps.get(r.target) ?? []), r.required]);
  const seen = new Set<string>();
  const stack = [candidate.required];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === candidate.target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(deps.get(cur) ?? []));
  }
  return false;
}

export type LockReason =
  | { kind: "release_at"; release_at: string }
  | { kind: "lesson_complete"; lesson_id: string | null; lesson_title: string }
  | { kind: "quiz_min_score"; quiz_id: string; quiz_title: string; min_score_pct: number; current_pct: number | null };
