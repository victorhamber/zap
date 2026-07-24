import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMetaMessageType } from "./metaWebhook.js";

describe("parseMetaMessageType — botões / template / interativo", () => {
  it("button_reply extrai o título", () => {
    const r = parseMetaMessageType({
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "1", title: "Quero sim" } }
    });
    assert.equal(r.text, "Quero sim");
    assert.equal(r.type, "chat");
  });

  it("interactive com botões de ação extrai body + labels", () => {
    const r = parseMetaMessageType({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Escolha" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "a", title: "Sim" } },
            { type: "reply", reply: { id: "b", title: "Não" } }
          ]
        }
      }
    });
    assert.match(r.text, /Escolha/);
    assert.match(r.text, /Sim/);
  });

  it("template com components não fica vazio", () => {
    const r = parseMetaMessageType({
      type: "template",
      template: {
        name: "analise_cota",
        components: [{ type: "BODY", text: "Concluímos a análise da sua cota." }]
      }
    });
    assert.match(r.text, /Concluímos a análise/);
  });

  it("tipo desconhecido sem texto fica vazio (para o webhook descartar)", () => {
    const r = parseMetaMessageType({ type: "reaction", reaction: { emoji: "👍" } });
    assert.equal(r.text, "");
  });
});
