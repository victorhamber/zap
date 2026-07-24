import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEvolutionMessagePayload } from "./evolutionWebhook.js";

const body = { event: "messages.upsert", instance: "ass" };

function payload(message: Record<string, unknown>) {
  return {
    key: { remoteJid: "5511502891020@s.whatsapp.net", fromMe: false, id: "ABC123" },
    messageTimestamp: 1_700_000_000,
    message
  };
}

describe("parseEvolutionMessagePayload — mensagens com botão", () => {
  it("template com botões não é descartado e extrai texto + botões", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        templateMessage: {
          hydratedTemplate: {
            hydratedContentText: "Concluímos a análise da sua cota.",
            hydratedButtons: [{ urlButton: { displayText: "Acessar plataforma", url: "https://x.com" } }]
          }
        }
      })
    );
    assert.ok(p, "não deve retornar null");
    assert.match(p!.text, /Concluímos a análise/);
    assert.match(p!.text, /Acessar plataforma/);
    assert.match(p!.text, /https:\/\/x\.com/);
  });

  it("buttonsMessage extrai contentText e labels", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        buttonsMessage: {
          contentText: "Escolha uma opção",
          buttons: [{ buttonText: { displayText: "Sim" } }, { buttonText: { displayText: "Não" } }]
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /Escolha uma opção/);
    assert.match(p!.text, /Sim/);
  });

  it("mensagem interativa (nativeFlow) extrai body.text", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({ interactiveMessage: { body: { text: "Ver proposta disponível" } } })
    );
    assert.ok(p);
    assert.match(p!.text, /Ver proposta disponível/);
  });

  it("nativeFlow com buttonParamsJSON extrai label e url", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        interactiveMessage: {
          body: { text: "Abra o link" },
          nativeFlowMessage: {
            buttons: [
              {
                name: "cta_url",
                buttonParamsJSON: JSON.stringify({
                  display_text: "Acessar plataforma",
                  url: "https://exemplo.com"
                })
              }
            ]
          }
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /Acessar plataforma/);
    assert.match(p!.text, /https:\/\/exemplo\.com/);
    assert.doesNotMatch(p!.text, /cta_url/);
  });

  it("listMessage extrai título e opções", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        listMessage: {
          title: "Menu",
          description: "Escolha",
          buttonText: "Ver opções",
          sections: [{ rows: [{ title: "Opção A" }, { title: "Opção B" }] }]
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /Menu/);
    assert.match(p!.text, /Opção A/);
  });

  it("desembrulha ephemeralMessage com template dentro", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        ephemeralMessage: {
          message: { templateMessage: { hydratedTemplate: { hydratedContentText: "Oi via efêmera" } } }
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /Oi via efêmera/);
  });

  it("resposta de botão vira texto do cliente", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({ buttonsResponseMessage: { selectedDisplayText: "Quero sim" } })
    );
    assert.ok(p);
    assert.equal(p!.text, "Quero sim");
  });

  it("template só com caption de mídia + botões (sem hydratedContentText)", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        templateMessage: {
          hydratedTemplate: {
            imageMessage: { caption: "Sua proposta está pronta." },
            hydratedButtons: {
              "0": { urlButton: { displayText: "Ver proposta", url: "https://w.meta.me/s/abc" } }
            }
          }
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /Sua proposta está pronta/);
    assert.match(p!.text, /Ver proposta/);
    assert.doesNotMatch(p!.text, /Mensagem com botões/);
  });

  it("message stringificado (JSON) ainda extrai template", () => {
    const p = parseEvolutionMessagePayload(body, {
      key: { remoteJid: "441536858300@s.whatsapp.net", fromMe: false, id: "STR1" },
      messageTimestamp: 1_700_000_000,
      message: JSON.stringify({
        templateMessage: {
          hydratedTemplate: {
            hydratedContentText: "Olá via JSON string",
            hydratedButtons: [{ urlButton: { displayText: "Abrir", url: "https://x.test" } }]
          }
        }
      })
    });
    assert.ok(p);
    assert.match(p!.text, /Olá via JSON string/);
  });

  it("nativeFlow só com messageParamsJson (sem body.text)", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        interactiveMessage: {
          nativeFlowMessage: {
            messageParamsJson: JSON.stringify({
              title: "Consorcei",
              body: "A análise da sua cota foi concluída."
            }),
            buttons: [
              {
                name: "cta_url",
                buttonParamsJSON: JSON.stringify({
                  display_text: "Ver proposta",
                  url: "https://w.meta.me/s/xyz"
                })
              }
            ]
          }
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /análise da sua cota/);
    assert.match(p!.text, /Ver proposta/);
  });

  it("texto simples continua funcionando", () => {
    const p = parseEvolutionMessagePayload(body, payload({ conversation: "oi tudo bem" }));
    assert.ok(p);
    assert.equal(p!.text, "oi tudo bem");
  });
});

describe("parseWhatsAppTimestamp", () => {
  it("aceita number em segundos e ms", async () => {
    const { parseWhatsAppTimestamp } = await import("./evolutionWebhook.js");
    assert.equal(parseWhatsAppTimestamp(1_700_000_000), 1_700_000_000_000);
    assert.equal(parseWhatsAppTimestamp(1_700_000_000_000), 1_700_000_000_000);
  });

  it("aceita string numérica (sync Evolution)", async () => {
    const { parseWhatsAppTimestamp } = await import("./evolutionWebhook.js");
    assert.equal(parseWhatsAppTimestamp("1700000000"), 1_700_000_000_000);
  });

  it("aceita Long protobuf { low, high }", async () => {
    const { parseWhatsAppTimestamp } = await import("./evolutionWebhook.js");
    assert.equal(parseWhatsAppTimestamp({ low: 1_700_000_000, high: 0 }), 1_700_000_000_000);
  });
});
