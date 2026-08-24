import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatKnowledgeSnippet,
  isKnownWrongCapitalMinimum,
  redactLeadNamesFromKnowledge,
  type KnowledgeRow
} from "./knowledgeRetrieval.js";

describe("knowledgeRetrieval", () => {
  it("formata qa_pair legível para o modelo", () => {
    const row: KnowledgeRow = {
      id: "1",
      kind: "qa_pair",
      topic: "Reembolso",
      content: JSON.stringify({
        question: "Qual a política de reembolso?",
        answerBase: "7 dias após a compra, conforme Hotmart."
      }),
      chatId: "5511999998888@s.whatsapp.net",
      createdAt: new Date()
    };
    const text = formatKnowledgeSnippet(row);
    assert.match(text, /Pergunta: Qual a política de reembolso/);
    assert.match(text, /7 dias após a compra/);
  });

  it("detecta capital mínimo incorreto em reais", () => {
    assert.equal(
      isKnownWrongCapitalMinimum("Recomenda-se capital mínimo de pelo menos R$ 1.000"),
      true
    );
    assert.equal(
      isKnownWrongCapitalMinimum(
        "Você pode iniciar com qualquer valor, mas é recomendado começar com pelo menos R$100,00"
      ),
      true
    );
    assert.equal(
      isKnownWrongCapitalMinimum("Conta cent: capital mínimo USD 50"),
      false
    );
    assert.equal(
      isKnownWrongCapitalMinimum("Conta standard: USD 3.000 ou acima"),
      false
    );
  });

  it("remove vocativos de outros leads no aprendizado", () => {
    assert.match(
      redactLeadNamesFromKnowledge("Oi Gustavo, o capital mínimo é USD 50", "Victor"),
      /^Oi,? o capital mínimo/
    );
    assert.match(
      redactLeadNamesFromKnowledge("Oi Victor, segue o acesso", "Victor"),
      /Oi Victor/
    );
  });
});
