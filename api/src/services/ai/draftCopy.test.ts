import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDraftJson, uploadNameFromUrl } from "./draftCopy.js";

describe("rascunho da IA", () => {
  it("aceita só arquivo da pasta uploads", () => {
    assert.equal(uploadNameFromUrl("https://zap.exemplo/uploads/abc.jpg"), "abc.jpg");
    assert.equal(uploadNameFromUrl("https://zap.exemplo/etc/passwd"), null);
    assert.equal(uploadNameFromUrl("https://zap.exemplo/uploads/../secret.jpg"), null);
  });

  it("separa mensagem de WhatsApp e e-mail", () => {
    assert.equal(parseDraftJson("whatsapp", JSON.stringify({ text: "Oi grupo" })).text, "Oi grupo");
    const email = parseDraftJson(
      "email",
      JSON.stringify({ subject: "Acesso", preheader: "Entra hoje", paragraphs: ["Olá {{name}}"] })
    );
    assert.equal(email.subject, "Acesso");
    assert.match(email.html, /Olá \{\{name\}\}/);
    assert.throws(() => parseDraftJson("whatsapp", "{"));
  });
});
