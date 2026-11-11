import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextFollowUp, parseFollowUpSteps } from "./coldFollowUp.js";

const hour = 60 * 60 * 1000;
const steps = [
  { hours: 24, flowId: "a" },
  { hours: 48, flowId: "b" }
];

describe("parseFollowUpSteps", () => {
  it("ignora passo sem fluxo e cai no legado", () => {
    assert.deepEqual(parseFollowUpSteps([{ hours: 10, flowId: "" }], { hours: 24, flowId: "legado" }), [
      { hours: 24, flowId: "legado" }
    ]);
  });

  it("guarda no máximo 3 passos", () => {
    const raw = [1, 2, 3, 4].map((n) => ({ hours: n, flowId: `f${n}` }));
    assert.equal(parseFollowUpSteps(raw).length, 3);
  });
});

describe("nextFollowUp", () => {
  it("não começa se a última mensagem foi da pessoa", () => {
    assert.equal(
      nextFollowUp({
        steps,
        sent: 0,
        lastFromMe: false,
        lastMessageAt: 0,
        lastFiredAt: null,
        now: 48 * hour
      }),
      null
    );
  });

  it("manda o primeiro passo depois do silêncio e o segundo depois do primeiro", () => {
    const first = nextFollowUp({
      steps,
      sent: 0,
      lastFromMe: true,
      lastMessageAt: hour,
      lastFiredAt: null,
      now: 25 * hour
    });
    assert.equal(first?.flowId, "a");
    const second = nextFollowUp({
      steps,
      sent: 1,
      lastFromMe: true,
      lastMessageAt: 24 * hour,
      lastFiredAt: 24 * hour,
      now: 72 * hour
    });
    assert.equal(second?.flowId, "b");
  });

  it("para se a pessoa respondeu depois do passo anterior", () => {
    assert.equal(
      nextFollowUp({
        steps,
        sent: 1,
        lastFromMe: false,
        lastMessageAt: 30 * hour,
        lastFiredAt: 24 * hour,
        now: 80 * hour
      }),
      null
    );
  });
});
