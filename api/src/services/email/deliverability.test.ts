import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  htmlToPlainText,
  readUnsubscribeToken,
  signUnsubscribeToken,
  summarizeResendDomains,
  wrapEmailHtml
} from "./deliverability.js";

describe("e-mail entregável", () => {
  it("gera texto com o link ao lado do rótulo", () => {
    const text = htmlToPlainText(
      `<p>Olá</p><p><a href="https://loja.exemplo/acesso">Entrar</a></p>`
    );
    assert.match(text, /Olá/);
    assert.match(text, /Entrar \(https:\/\/loja\.exemplo\/acesso\)/);
  });

  it("o token de cancelar só abre o e-mail que foi assinado", () => {
    const secret = "segredo-de-teste-com-32-caracteres";
    const token = signUnsubscribeToken("Pessoa@Exemplo.com", secret);
    assert.equal(readUnsubscribeToken(token, secret), "pessoa@exemplo.com");
    assert.equal(readUnsubscribeToken(`${token}x`, secret), null);
    assert.equal(readUnsubscribeToken(token, "outro-segredo-de-teste-32-chars"), null);
  });

  it("o envelope traz preheader, remetente e o link de cancelar", () => {
    const html = wrapEmailHtml({
      bodyHtml: "<p>Oi</p>",
      preheader: "Seu acesso",
      from: "ola@loja.com",
      fromName: "Loja",
      postalAddress: "Rua 1, São Paulo",
      unsubscribeHref: "https://zap.exemplo/api/email/unsubscribe?t=abc"
    });
    assert.match(html, /Seu acesso/);
    assert.match(html, /Loja/);
    assert.match(html, /Rua 1, São Paulo/);
    assert.match(html, /Não quero mais receber/);
    assert.match(html, /https:\/\/zap\.exemplo\/api\/email\/unsubscribe\?t=abc/);
  });

  it("lê SPF e DKIM do domínio do remetente", () => {
    const report = summarizeResendDomains(
      {
        data: [
          {
            name: "loja.com",
            status: "verified",
            records: [
              { record: "SPF", status: "verified" },
              { record: "DKIM", status: "verified" }
            ]
          }
        ]
      },
      "ola@loja.com"
    );
    assert.equal(report.found, true);
    assert.equal(report.spf, "verified");
    assert.equal(report.dkim, "verified");
    assert.equal(report.dmarc, "missing");
  });
});
