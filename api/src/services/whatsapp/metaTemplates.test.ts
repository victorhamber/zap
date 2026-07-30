import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMetaTemplate, type MetaTemplateDefinition } from "./metaTemplates.js";

const definition: MetaTemplateDefinition = {
  name: "analise_cota",
  language: "pt_BR",
  components: [
    { type: "HEADER", format: "TEXT", text: "Olá {{1}}!" },
    { type: "BODY", text: "Sua cota de {{1}} foi aprovada em {{2}}." },
    { type: "FOOTER", text: "Equipe Trajettu" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "URL", text: "Ver proposta", url: "https://app.exemplo.com/{{1}}" },
        { type: "QUICK_REPLY", text: "Falar com humano" }
      ]
    }
  ]
};

describe("renderMetaTemplate — texto real do template oficial", () => {
  it("substitui parâmetros posicionais de header e body", () => {
    const { parts } = renderMetaTemplate(definition, [
      { type: "header", parameters: [{ type: "text", text: "Carlos" }] },
      {
        type: "body",
        parameters: [
          { type: "text", text: "R$ 50.000" },
          { type: "text", text: "12x" }
        ]
      }
    ]);
    assert.deepEqual(parts, [
      "Olá Carlos!",
      "Sua cota de R$ 50.000 foi aprovada em 12x.",
      "Equipe Trajettu"
    ]);
  });

  it("botão URL dinâmico recebe o sufixo enviado no componente button", () => {
    const { buttons } = renderMetaTemplate(definition, [
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc123" }] }
    ]);
    assert.equal(buttons[0].label, "Ver proposta");
    assert.equal(buttons[0].url, "https://app.exemplo.com/abc123");
    assert.equal(buttons[1].label, "Falar com humano");
    assert.equal(buttons[1].url, undefined);
  });

  it("parâmetros nomeados também são resolvidos", () => {
    const named: MetaTemplateDefinition = {
      name: "boas_vindas",
      language: "pt_BR",
      components: [{ type: "BODY", text: "Bem-vindo, {{nome}}!" }]
    };
    const { parts } = renderMetaTemplate(named, [
      { type: "body", parameters: [{ type: "text", parameter_name: "nome", text: "Ana" }] }
    ]);
    assert.deepEqual(parts, ["Bem-vindo, Ana!"]);
  });

  it("header de mídia não vira texto solto", () => {
    const media: MetaTemplateDefinition = {
      name: "promo",
      language: "pt_BR",
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Promoção do mês" }
      ]
    };
    const { parts } = renderMetaTemplate(media, []);
    assert.deepEqual(parts, ["Promoção do mês"]);
  });

  it("sem parâmetros enviados, mantém o placeholder em vez de apagar o texto", () => {
    const { parts } = renderMetaTemplate(definition, []);
    assert.match(parts[1], /Sua cota de \{\{1\}\}/);
  });
});
