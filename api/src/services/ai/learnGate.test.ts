import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  knowledgeSourceMsgId,
  learnKindForHistoryMessage,
  isHumanAnswerSource
} from "./learnGate.js";

describe("learnGate", () => {
  it("gera id de dedup com inbox id", () => {
    assert.equal(
      knowledgeSourceMsgId({ id: "abc", waMessageId: null }),
      "inbox:abc"
    );
    assert.equal(
      knowledgeSourceMsgId({ id: "abc", waMessageId: "WA123" }),
      "WA123"
    );
  });

  it("classifica mensagens do histórico", () => {
    assert.equal(learnKindForHistoryMessage({ fromMe: false, source: "webhook" }), "question");
    assert.equal(learnKindForHistoryMessage({ fromMe: true, source: "manual" }), "answer");
    assert.equal(learnKindForHistoryMessage({ fromMe: true, source: "webhook" }), "answer");
    assert.equal(learnKindForHistoryMessage({ fromMe: true, source: "flow" }), null);
    assert.equal(learnKindForHistoryMessage({ fromMe: true, source: "ai" }), null);
  });

  it("identifica resposta humana", () => {
    assert.equal(isHumanAnswerSource("manual"), true);
    assert.equal(isHumanAnswerSource("webhook"), true);
    assert.equal(isHumanAnswerSource("flow"), false);
  });
});
