import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  expandChatIdVariants,
  getMappedPhoneJid,
  recordWaJidMappingSync,
  clearWaLidMapMemory
} from "./waLidMap.js";
import { isGroupLikeJid, isLikelyInternalLidJid } from "./waJid.js";

const SESSION = "teste";
const GROUP = "120363123456789012@g.us";
const MEMBER = "5511987654321@s.whatsapp.net";
const MEMBER_LID = "78901234567890@lid";

describe("JID de grupo nunca entra no mapa @lid → telefone", () => {
  beforeEach(() => {
    clearWaLidMapMemory();
  });

  it("120363…@g.us não é tratado como id interno @lid", () => {
    assert.equal(isGroupLikeJid(GROUP), true);
    assert.equal(isLikelyInternalLidJid(GROUP), false);
  });

  it("mensagem de grupo não mapeia o grupo para o telefone do participante", () => {
    // Cenário do bug: webhook de grupo traz remoteJid=grupo, participant=membro.
    recordWaJidMappingSync(SESSION, GROUP, "", MEMBER, "");
    assert.equal(getMappedPhoneJid(SESSION, GROUP), null);
  });

  it("par @lid ↔ telefone do participante continua sendo aprendido", () => {
    recordWaJidMappingSync(SESSION, GROUP, "", MEMBER_LID, MEMBER);
    assert.equal(getMappedPhoneJid(SESSION, MEMBER_LID), MEMBER);
  });

  it("variantes de um grupo não incluem telefone de ninguém", async () => {
    recordWaJidMappingSync(SESSION, GROUP, "", MEMBER_LID, MEMBER);
    const variants = await expandChatIdVariants(SESSION, GROUP);
    assert.deepEqual(variants, [GROUP]);
    assert.equal(
      variants.some((v) => v.includes("@s.whatsapp.net") || v.endsWith("@lid")),
      false
    );
  });

  it("canal (@newsletter) também resolve só para si", async () => {
    const channel = "120363999888777@newsletter";
    recordWaJidMappingSync(SESSION, channel, "", MEMBER_LID, MEMBER);
    assert.equal(getMappedPhoneJid(SESSION, channel), null);
    assert.deepEqual(await expandChatIdVariants(SESSION, channel), [channel]);
  });

  it("contato direto continua expandindo para as variantes de sempre", async () => {
    const variants = await expandChatIdVariants(SESSION, MEMBER);
    assert.ok(variants.includes("5511987654321@c.us"));
    assert.ok(variants.includes("5511987654321@lid"));
    assert.ok(variants.includes(MEMBER));
  });
});
