import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DatabaseService } from "../src/database/database.service";
import {
  recipientLocale,
  SERVER_COPY,
  serverCopy,
} from "../src/i18n/server-copy";
import { partnerActivityPushPayload } from "../src/notifications/partner-activity-alerts";
import { describeStreakRisk } from "../src/notifications/push/streak-risk";

const dbWith = (user: unknown) =>
  ({
    user: { findUnique: async () => user },
  }) as unknown as DatabaseService;

describe("I18N-06 server-written copy", () => {
  it("writes every push in Spanish when the account chose it", () => {
    const es = serverCopy("es");
    assert.equal(es.restOverTitle, "Terminó el descanso");
    assert.equal(es.restNextBody("Press de banca"), "Sigue: Press de banca.");
    assert.equal(
      es.streakBody(1, 3),
      "Tu racha de 1 día sigue si entrenas hoy. Pasaron 3 días desde tu última sesión.",
    );
    assert.equal(
      es.trainingDayBody(["Torso", "Pierna", "Full"]),
      "Planificado para hoy: Torso, Pierna y Full.",
    );
    assert.equal(
      es.partnerSessionTitle("Ana"),
      "Ana completó un entrenamiento",
    );
  });

  it("keeps English as it was, and falls back to it for null or unknown", () => {
    assert.equal(serverCopy(null), SERVER_COPY.en);
    assert.equal(serverCopy("fr"), SERVER_COPY.en);
    assert.equal(
      describeStreakRisk({ runDays: 5, daysSince: 3 } as never),
      "Your 5 days run continues if you train today. It has been 3 days since your last session.",
    );
    assert.equal(
      SERVER_COPY.en.trainingDayBody(["A", "B"]),
      "A and B is planned for today.",
    );
  });

  it("never tells anyone to train, in either language (NOTIF-06)", () => {
    const imperative = /^(train|go|don't|entrena|ve |no pierdas)/i;
    for (const copy of Object.values(SERVER_COPY)) {
      assert.doesNotMatch(copy.streakBody(4, 3), imperative);
      assert.doesNotMatch(copy.streakTitle, imperative);
    }
  });

  it("writes a partner alert in the recipient language", () => {
    const row = {
      kind: "TRAINING_PARTNER_ACHIEVEMENT" as const,
      sourceKey: "k",
      payload: {},
      actor: { username: "ana", name: "Ana", lastName: null },
    };
    assert.equal(
      partnerActivityPushPayload(row, "es")?.title,
      "Ana obtuvo un logro",
    );
    assert.equal(partnerActivityPushPayload(row, "es")?.body, "Logro");
    assert.equal(
      partnerActivityPushPayload(row)?.title,
      "Ana earned an achievement",
    );
  });

  it("reads the recipient language and never fails a push over it", async () => {
    assert.equal(await recipientLocale(dbWith({ locale: "es" }), "u"), "es");
    assert.equal(await recipientLocale(dbWith({ locale: null }), "u"), "en");
    assert.equal(await recipientLocale(dbWith(null), "u"), "en");
    assert.equal(
      await recipientLocale({} as unknown as DatabaseService, "u"),
      "en",
    );
  });
});
