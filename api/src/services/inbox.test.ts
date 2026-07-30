import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeChats, normalizeGroups } from "./inbox.js";

describe("classificação grupo x direto", () => {
  it("contato de telefone com flag isGroup=true NÃO vira grupo", () => {
    // Cenário do bug: a Evolution marcou um contato direto como isGroup.
    const [chat] = normalizeChats([
      { id: "5511943748218@s.whatsapp.net", isGroup: true, pushName: "EA TREND" }
    ]);
    assert.ok(chat);
    assert.equal(chat.kind, "direct");
    assert.equal(chat.isGroup, false);
  });

  it("id de telefone SEM sufixo + flag isGroup também fica direto", () => {
    const [chat] = normalizeChats([{ id: "5511943748218", isGroup: true, name: "EA TREND" }]);
    assert.ok(chat);
    assert.equal(chat.kind, "direct");
    assert.ok(chat.id.endsWith("@s.whatsapp.net") || chat.id.endsWith("@c.us"));
  });

  it("grupo real (@g.us) continua grupo", () => {
    const [chat] = normalizeChats([
      { id: "120363123456789012@g.us", isGroup: true, subject: "Meu Grupo" }
    ]);
    assert.ok(chat);
    assert.equal(chat.kind, "group");
    assert.equal(chat.isGroup, true);
  });

  it("normalizeGroups ignora entrada de telefone (grupo falso)", () => {
    const out = normalizeGroups([
      { id: "5511943748218@s.whatsapp.net", pushName: "EA TREND", isGroup: true }
    ]);
    // não deve marcar um telefone como grupo
    assert.equal(
      out.filter((c) => c.isGroup && c.id.includes("@s.whatsapp.net")).length,
      0
    );
  });

  it("normalizeGroups mantém grupo real", () => {
    const out = normalizeGroups([{ id: "120363123456789012@g.us", subject: "Grupo X" }]);
    const g = out.find((c) => c.id.includes("@g.us"));
    assert.ok(g);
    assert.equal(g.kind, "group");
    assert.equal(g.isGroup, true);
  });
});

describe("nome do chat não pega o remetente da última mensagem", () => {
  it("grupo usa o assunto, não o pushName de quem mandou por último", () => {
    const [chat] = normalizeChats([
      {
        id: "120363123456789012@g.us",
        subject: "Time Comercial",
        pushName: "João Vendedor",
        notify: "João Vendedor",
        lastMessage: {
          key: { remoteJid: "120363123456789012@g.us", participant: "5511987654321@s.whatsapp.net" },
          pushName: "Maria Cliente",
          message: { conversation: "bom dia" }
        }
      }
    ]);
    assert.ok(chat);
    assert.equal(chat.name, "Time Comercial");
    assert.equal(chat.kind, "group");
  });

  it("grupo sem assunto não vira o nome de um participante", () => {
    const [chat] = normalizeChats([
      {
        id: "120363123456789012@g.us",
        lastMessage: {
          key: { participant: "5511987654321@s.whatsapp.net" },
          pushName: "Maria Cliente",
          message: { conversation: "oi" }
        }
      }
    ]);
    assert.ok(chat);
    assert.notEqual(chat.name, "Maria Cliente");
    assert.match(chat.name, /^Grupo/);
  });

  it("grupo não expõe o 120363… como telefone", () => {
    const [chat] = normalizeChats([{ id: "120363123456789012@g.us", subject: "Grupo Y" }]);
    assert.ok(chat);
    assert.equal(chat.phone, "");
  });

  it("conversa direta ainda aproveita o pushName de mensagem recebida", () => {
    const [chat] = normalizeChats([
      {
        id: "5511987654321@s.whatsapp.net",
        lastMessage: {
          key: { fromMe: false },
          pushName: "Carlos",
          message: { conversation: "oi" }
        }
      }
    ]);
    assert.ok(chat);
    assert.equal(chat.name, "Carlos");
  });

  it("conversa direta ignora pushName quando a última mensagem foi minha", () => {
    const [chat] = normalizeChats([
      {
        id: "5511987654321@s.whatsapp.net",
        lastMessage: {
          key: { fromMe: true },
          pushName: "Eu Mesmo",
          message: { conversation: "enviado" }
        }
      }
    ]);
    assert.ok(chat);
    assert.notEqual(chat.name, "Eu Mesmo");
  });
});
