// CSV reading for the enrollment import (RFC 4180 with the leniency spreadsheets need).
// Pure functions: shared by the browser (column preview) and the server (validation).

export type CsvDelimiter = "," | ";" | "\t";

/** One logical record. `line` is the physical line where the record starts (1-based). */
export type CsvRecord = { line: number; cells: string[] };

export type CsvParseResult = {
  records: CsvRecord[];
  delimiter: CsvDelimiter;
  /** Set when the input stops inside a quoted field. */
  error?: { kind: "unterminated_quote"; line: number };
  /** True when parsing stopped at `maxRecords`. */
  truncated: boolean;
};

const DELIMITERS: CsvDelimiter[] = [",", ";", "\t"];

/**
 * Picks the delimiter that occurs most often (outside quotes) in the first record.
 * Spreadsheets in many locales export with semicolons; tab-separated text pastes too.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    if (!inQuotes && counts.has(ch as CsvDelimiter)) counts.set(ch as CsvDelimiter, (counts.get(ch as CsvDelimiter) ?? 0) + 1);
  }
  let best: CsvDelimiter = ",";
  for (const d of DELIMITERS) if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  return best;
}

/**
 * Parses CSV text: quoted fields with doubled quotes, delimiters and line breaks inside
 * quotes, CRLF/LF/CR line endings, and a leading UTF-8 byte order mark. Line breaks
 * inside a quoted field are normalized to "\n". Blank lines become records with one
 * empty cell (callers skip them). Text is returned exactly as written (no trimming).
 */
export function parseCsv(input: string, options: { delimiter?: CsvDelimiter; maxRecords?: number } = {}): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let field = "";
  let quotedField = false;
  let inQuotes = false;
  let line = 1;
  let recordStart = 1;

  const endField = () => {
    row.push(field);
    field = "";
    quotedField = false;
  };
  const endRecord = () => {
    records.push({ line: recordStart, cells: row });
    row = [];
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        field += "\n";
        line++;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "" && !quotedField) {
      inQuotes = true;
      quotedField = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endField();
      endRecord();
      line++;
      recordStart = line;
      i++;
      if (records.length >= maxRecords) {
        return { records, delimiter, truncated: i < text.length };
      }
      continue;
    }
    // A stray quote inside an unquoted field is kept as text.
    field += ch;
    i++;
  }
  if (inQuotes) {
    return { records, delimiter, truncated: false, error: { kind: "unterminated_quote", line: recordStart } };
  }
  if (field !== "" || quotedField || row.length > 0) {
    endField();
    endRecord();
  }
  return { records, delimiter, truncated: false };
}

/** True when every cell of a record is empty or whitespace. */
export function isBlankRecord(record: CsvRecord): boolean {
  return record.cells.every((c) => c.trim() === "");
}

/** Lower-cased, accent-free, single-spaced header text for matching column names. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
