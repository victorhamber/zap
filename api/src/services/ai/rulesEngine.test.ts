import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  validateReplyAgainstRules
} from "./rulesEngine.js";
import { phoneFromChatId, isGroupChatId } from "./tagGate.js";

describe("rulesEngine", () => {
  it("monta system prompt com links oficiais", () => {
    const prompt = buildSystemPrompt({
      productContext: "Curso X",
      rulesAllowed: "Informar preço oficial",
      rulesForbidden: "Prometer garantia vitalícia",
      officialLinks: [{ trigger: "comprar", url: "https://exemplo.com/checkout", label: "Checkout" }]
    });
    assert.match(prompt, /Curso X/);
    assert.match(prompt, /https:\/\/exemplo.com\/checkout/);
  });

  it("bloqueia resposta que viola forbidden", () => {
    const r = validateReplyAgainstRules(
      "Sim, garantia vitalícia para sempre!",
      "garantia vitalícia"
    );
    assert.equal(r.ok, false);
  });

  it("aceita resposta válida", () => {
    const r = validateReplyAgainstRules("O valor é consultado no site oficial.", "");
    assert.equal(r.ok, true);
  });
});

describe("tagGate helpers", () => {
  it("extrai telefone do chatId", () => {
    assert.equal(phoneFromChatId("5511999998888@s.whatsapp.net"), "5511999998888");
  });

  it("detecta grupo", () => {
    assert.equal(isGroupChatId("120363@g.us"), true);
    assert.equal(isGroupChatId("5511@c.us"), false);
  });
});
