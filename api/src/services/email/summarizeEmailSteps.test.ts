import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emailStepOutcome, summarizeEmailSteps } from "./summarizeEmailSteps.js";

describe("resumo dos e-mails do fluxo", () => {
  it("separa enviado, cancelado e falha", () => {
    assert.equal(emailStepOutcome("ok", "E-mail enviado para a@b.com"), "sent");
    assert.equal(emailStepOutcome("ok", "E-mail não enviado: a@b.com cancelou o recebimento"), "skipped");
    assert.equal(emailStepOutcome("failed", "Destinatário de e-mail inválido"), "failed");
  });

  it("soma por fluxo", () => {
    const summary = summarizeEmailSteps([
      { flow: "Novo fluxo", status: "ok", message: "E-mail enviado para a@b.com" },
      { flow: "Novo fluxo", status: "failed", message: "assunto vazio" },
      { flow: "Outro", status: "ok", message: "E-mail não enviado: c@d.com cancelou" }
    ]);
    assert.deepEqual(
      { sent: summary.sent, skipped: summary.skipped, failed: summary.failed },
      { sent: 1, skipped: 1, failed: 1 }
    );
    assert.equal(summary.byFlow[0]?.flow, "Novo fluxo");
    assert.equal(summary.byFlow[0]?.sent, 1);
  });
});
