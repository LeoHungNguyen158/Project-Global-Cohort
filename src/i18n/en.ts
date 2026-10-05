// English interface strings, merged from per-area dictionaries. Add a sibling
// dictionary (e.g. vi.ts) with the same keys to translate the interface.
// Course content is authored text and is never machine-translated.
//
// Namespaces by file (each file is owned by one area of the app):
//   core.ts       app.*, nav.*, common.*, auth.*, activity.*, courses.*, course.*
//   learning.ts   learn.*, author.*, people.*
//   assessment.ts quiz.*, assign.*
//   grades.ts     grades.*, gradebook.*, cal.*
//   comms.ts      msg.*, ann.*, disc.*, cohort.*, community.*
//   admin.ts      admin.*
//   account.ts    catalog.*, tools.*, profile.*, invite.*, help.*, legal.*
import { core } from "./messages/core";
import { learning } from "./messages/learning";
import { assessment } from "./messages/assessment";
import { grades } from "./messages/grades";
import { comms } from "./messages/comms";
import { admin } from "./messages/admin";
import { account } from "./messages/account";

export const dictionaries = { core, learning, assessment, grades, comms, admin, account };

export const en = { ...core, ...learning, ...assessment, ...grades, ...comms, ...admin, ...account };

export type MessageKey = keyof typeof en;
