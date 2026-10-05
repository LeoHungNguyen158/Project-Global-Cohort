// Name search that works for Vietnamese and other accented names: "nguyen van an"
// matches "Nguyễn Văn An", "dang" matches "Đặng". Sorting uses localeCompare.

/** Lower-cased, accent-free form of a string for matching (never for display). */
export function foldText(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query appears in the name (accent- and case-insensitive). */
export function matchesQuery(name: string, query: string): boolean {
  const q = foldText(query);
  if (!q) return true;
  const hay = foldText(name);
  return q.split(" ").every((word) => hay.includes(word));
}

export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, ["vi", "en"], { sensitivity: "base" });
}
