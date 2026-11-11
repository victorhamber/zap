import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextStage } from "./contactStage.js";

describe("nextStage", () => {
  it("inbound só sai de novo", () => {
    assert.equal(nextStage("novo", "em_conversa", "inbound"), "em_conversa");
    assert.equal(nextStage("comprou", "em_conversa", "inbound"), null);
    assert.equal(nextStage("perdido", "em_conversa", "inbound"), null);
  });

  it("compra vai para comprou e não repete", () => {
    assert.equal(nextStage("em_conversa", "comprou", "purchase"), "comprou");
    assert.equal(nextStage("perdido", "comprou", "purchase"), "comprou");
    assert.equal(nextStage("comprou", "comprou", "purchase"), null);
  });

  it("manual troca qualquer etapa", () => {
    assert.equal(nextStage("comprou", "perdido", "manual"), "perdido");
    assert.equal(nextStage("novo", "novo", "manual"), null);
  });
});
