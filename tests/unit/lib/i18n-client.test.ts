import { describe, expect, it } from "vitest";
import { dictionaries } from "@/i18n/en";
import { t as serverT } from "@/i18n";
import * as core from "@/i18n/client/core";
import * as learning from "@/i18n/client/learning";
import * as assessment from "@/i18n/client/assessment";
import * as grades from "@/i18n/client/grades";
import * as comms from "@/i18n/client/comms";
import * as admin from "@/i18n/client/admin";
import * as account from "@/i18n/client/account";

// Client components load one area's strings plus the core ones; each must read exactly what
// the full dictionary says, placeholders included.
const CLIENT = { core, learning, assessment, grades, comms, admin, account } as const;

describe("client dictionaries", () => {
  for (const [area, mod] of Object.entries(CLIENT) as [keyof typeof CLIENT, { t: (k: string, v?: Record<string, string | number>) => string }][]) {
    it(`${area}: every core and ${area} key matches the full dictionary`, () => {
      const keys = [...Object.keys(dictionaries.core), ...Object.keys(dictionaries[area])];
      for (const key of keys) expect(mod.t(key, { name: "Nguyễn Thị Mai", count: 3 }), key).toBe(serverT(key as never, { name: "Nguyễn Thị Mai", count: 3 }));
    });
  }
});
