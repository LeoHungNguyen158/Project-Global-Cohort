// Interface strings for the grades area. Prefix every key with this area's namespace
// (see src/i18n/en.ts) so keys never collide across areas.
export const grades = {
  "grades.title": "Grades",
  "grades.scope": "Current Courses and Organizations",
  "grades.noReleased": "No released grades",
  "grades.emptyLearner": "When grades are available for this course, they appear here.",
  "grades.emptyStaff": "Your recently graded work will appear here.",
  "grades.toGrade": "{count} to grade",
  "grades.postGrades": "Post {count} grades",
  "grades.viewAllWork": "View all work ({count})",
  "grades.overall": "Overall (released items)",
} as const;
