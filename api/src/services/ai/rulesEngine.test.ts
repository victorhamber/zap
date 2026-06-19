import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  validateReplyAgainstRules,
  isRepetitiveReply
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

  it("orienta cumprimento neutro sem nome cadastrado", () => {
    const prompt = buildSystemPrompt({
      productContext: "Curso X",
      rulesAllowed: "",
      rulesForbidden: "",
      officialLinks: [],
      clientName: null
    });
    assert.match(prompt, /não informado/);
    assert.match(prompt, /Nunca use o nome do atendente/);
  });

  it("inclui nome do CRM quando cadastrado", () => {
    const prompt = buildSystemPrompt({
      productContext: "Curso X",
      rulesAllowed: "",
      rulesForbidden: "",
      officialLinks: [],
      clientName: "Maria"
    });
    assert.match(prompt, /Nome cadastrado no CRM: Maria/);
  });

  it("inclui tags do lead no prompt", () => {
    const prompt = buildSystemPrompt({
      productContext: "Curso X",
      rulesAllowed: "",
      rulesForbidden: "",
      officialLinks: [],
      leadTags: ["teste pago", "quente"]
    });
    assert.match(prompt, /teste pago, quente/);
    assert.match(prompt, /Não repita informações/);
  });

  it("detecta resposta repetitiva", () => {
    assert.equal(
      isRepetitiveReply("Sergiomar, tudo certo com o acesso ao teste?", [
        "Sergiomar, tudo certo com o acesso ao teste? Se tiver dúvida me fala."
      ]),
      true
    );
  });

  it("prioriza fatos oficiais sobre aprendizado histórico", () => {
    const prompt = buildSystemPrompt({
      productContext: "Curso X",
      officialFacts: "Conta cent: USD 50. Conta standard: USD 3.000.",
      rulesAllowed: "",
      rulesForbidden: "",
      officialLinks: []
    });
    assert.match(prompt, /FATOS OFICIAIS/);
    assert.match(prompt, /USD 50/);
    assert.match(prompt, /siga SEMPRE os fatos oficiais/);
    assert.match(prompt, /complementar/);
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
