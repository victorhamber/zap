import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messageReopensArchive } from "./inboxStore.js";

describe("arquivo da conversa", () => {
  const closedAt = Date.parse("2026-11-11T20:00:00.000Z");

  it("mensagem anterior ao Fechar não reabre", () => {
    const old = Date.parse("2026-10-28T12:00:00.000Z");
    assert.equal(messageReopensArchive(old, closedAt), false);
  });

  it("mensagem depois do Fechar reabre", () => {
    const fresh = closedAt + 60_000;
    assert.equal(messageReopensArchive(fresh, closedAt), true);
  });

  it("sem hora de arquivo, reabre", () => {
    assert.equal(messageReopensArchive(closedAt, undefined), true);
  });

  it("mensagem sem hora não reabre um arquivo marcado", () => {
    assert.equal(messageReopensArchive(0, closedAt), false);
  });
});
