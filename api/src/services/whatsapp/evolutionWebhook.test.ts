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

  it("template Meta (name + components BODY) sem hydratedContentText", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        templateMessage: {
          name: "analise_cota",
          language: { code: "pt_BR" },
          components: [
            { type: "BODY", text: "Concluímos a análise da sua cota, João." },
            {
              type: "BUTTONS",
              buttons: [{ type: "URL", text: "Ver proposta", url: "https://w.meta.me/s/abc" }]
            }
          ]
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /Concluímos a análise/);
    assert.match(p!.text, /Ver proposta/);
    assert.doesNotMatch(p!.text, /Mensagem com botões/);
  });

  it("template Meta só com parameters (sem text do BODY)", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        templateMessage: {
          name: "boas_vindas",
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: "Maria" }]
            }
          ]
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /Maria/);
    assert.doesNotMatch(p!.text, /Mensagem com botões/);
  });

  it("echo Evolution ▶️nome◀️ vira label de template", () => {
    const p = parseEvolutionMessagePayload(body, payload({ conversation: "▶️analise_cota◀️" }));
    assert.ok(p);
    assert.match(p!.text, /Template:\s*analise_cota/);
  });

  it("templateMessage vazio com messageType ainda não inventa texto falso além do placeholder", () => {
    const p = parseEvolutionMessagePayload(body, {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true, id: "T1" },
      messageTimestamp: 1_700_000_000,
      messageType: "templateMessage",
      message: { templateMessage: {} }
    });
    assert.ok(p);
    assert.match(p!.text, /Mensagem interativa|Template|Evolution|botões/i);
  });

  it("template opaco da Meta explica para ver no celular", () => {
    const p = parseEvolutionMessagePayload(body, {
      ...payload({
        templateMessage: {
          hydratedTemplate: {
            hydratedButtons: [{ urlButton: { displayText: "Saiba mais", url: "https://meta.com" } }]
          }
        }
      }),
      messageType: "templateMessage"
    });
    assert.ok(p);
    assert.match(p!.text, /Evolution|celular/i);
    assert.match(p!.text, /Saiba mais/);
  });

  it("varredura profunda acha texto escondido em messageParamsJson", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        interactiveMessage: {
          nativeFlowMessage: {
            messageParamsJson: JSON.stringify({
              title: "Atualizacao da Meta",
              body: "Revise as novas politicas da conta."
            })
          }
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /Atualizacao da Meta|politicas/i);
  });

  it("não vaza cta_url nem JSON de bottom_sheet no corpo", () => {
    const p = parseEvolutionMessagePayload(
      body,
      payload({
        interactiveMessage: {
          body: {
            text: "Olá, Victor. Alguém acabou de criar uma chave de acesso para a sua conta do Facebook."
          },
          nativeFlowMessage: {
            buttons: [
              {
                name: "cta_url",
                buttonParamsJSON: JSON.stringify({
                  display_text: "Não fui eu",
                  url: "https://facebook.com/security",
                  bottom_sheet: { in_thread_buttons_limit: 3, divider_indices: [] }
                })
              }
            ],
            messageParamsJson: JSON.stringify({
              bottom_sheet: { in_thread_buttons_limit: 3, divider_indices: [] }
            })
          }
        }
      })
    );
    assert.ok(p);
    assert.match(p!.text, /chave de acesso/);
    assert.match(p!.text, /Não fui eu/);
    assert.doesNotMatch(p!.text, /cta_url/i);
    assert.doesNotMatch(p!.text, /bottom_sheet/);
    assert.doesNotMatch(p!.text, /in_thread_buttons_limit/);
    assert.doesNotMatch(p!.text, /^\d{10,}$/m);
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
