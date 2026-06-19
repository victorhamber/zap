import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatKnowledgeSnippet, type KnowledgeRow } from "./knowledgeRetrieval.js";

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
});
