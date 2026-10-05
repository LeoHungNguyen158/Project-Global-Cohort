// Small helpers shared by the operator commands in scripts/.

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Production targets need an explicit flag on commands that write data. */
export function guardProduction(flag = "--confirm-production") {
  if ((process.env.APP_ENV ?? "").toLowerCase() === "production" && !hasFlag(flag)) {
    fail(`APP_ENV is "production". This command writes to the target project; re-run with ${flag} only if that is intended.`);
  }
}
