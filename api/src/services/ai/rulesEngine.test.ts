import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  validateReplyAgainstRules,
  isRepetitiveReply,
  stripDismissiveClosing,
  sanitizeReplyClientName
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
    assert.match(prompt, /OUTROS clientes/);
  });

  it("remove vocativo de outro lead e preserva o nome do CRM", () => {
    assert.equal(sanitizeReplyClientName("Oi Gustavo, tudo bem?", "Victor"), "Oi, tudo bem?");
    assert.equal(sanitizeReplyClientName("Olá Maria! Vamos nessa.", "Victor"), "Olá! Vamos nessa.");
    assert.equal(sanitizeReplyClientName("Oi Victor, tudo bem?", "Victor"), "Oi Victor, tudo bem?");
    assert.equal(sanitizeReplyClientName("Gustavo, segue o link.", "Victor"), "segue o link.");
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
    assert.match(prompt, /NÃO encerre/);
    assert.match(prompt, /DÓLARES/);
    assert.match(prompt, /Conta CENT/);
    assert.match(prompt, /cents/);
  });

  it("remove fechamento que soa como expulsar o cliente", () => {
    const cleaned = stripDismissiveClosing(
      "O capital mínimo na conta cent é USD 50. Se precisar de mais informações sobre como operar, estou à disposição!"
    );
    assert.match(cleaned, /USD 50/);
    assert.equal(/à disposição/i.test(cleaned), false);
    assert.equal(/se precisar de mais/i.test(cleaned), false);
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

  it("captura frase de chatbot banida (com marcador e aspas)", () => {
    const r = validateReplyAgainstRules(
      "Claro! Vou te ajudar com isso.",
      '- "Claro!"\n- "Certamente!"'
    );
    assert.equal(r.ok, false);
  });

  it("NÃO bloqueia resposta com preço, mesmo se a regra citar preço", () => {
    const r = validateReplyAgainstRules(
      "O Desafio é R$27,90 e o Anual R$747.",
      "Nunca ofereça desconto\nDesafio: R$27,90\nAnual: R$747,00"
    );
    assert.equal(r.ok, true);
  });

  it("NÃO bloqueia resposta com link, mesmo se a regra mencionar link", () => {
    const r = validateReplyAgainstRules(
      "Aqui está: 👉 https://go.trajettu.com/desafiopg",
      "Nunca use emojis além do 👉 para links"
    );
    assert.equal(r.ok, true);
  });

  it("NÃO bloqueia em regra longa que por acaso aparece na resposta", () => {
    const r = validateReplyAgainstRules(
      "Entendo, todo investimento tem risco mesmo.",
      "Nunca diga que o produto não tem risco"
    );
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
