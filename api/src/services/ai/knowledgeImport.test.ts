import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseKnowledgeImport } from "./knowledgeImport.js";

describe("parseKnowledgeImport", () => {
  it("parseia export JSON com wrapper", () => {
    const rows = parseKnowledgeImport(
      JSON.stringify({
        session: "a",
        items: [
          {
            kind: "question",
            topic: "preço",
            content: "Quanto custa?",
            chatId: "5511999998888@c.us",
            modality: "text"
          }
        ]
      }),
      "json"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "question");
    assert.equal(rows[0].content, "Quanto custa?");
  });

  it("parseia CSV exportado", () => {
    const csv = [
      "id,kind,topic,content,chatId,modality,sourceMsgId,createdAt",
      'x1,answer,preco,"Resposta base",5511@c.us,text,,2026-01-01T12:00:00.000Z'
    ].join("\n");
    const rows = parseKnowledgeImport(csv, "csv");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "answer");
    assert.equal(rows[0].chatId, "5511@c.us");
  });
});
