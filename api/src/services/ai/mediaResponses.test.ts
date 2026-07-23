import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMediaResponsesBlock,
  extractMediaResponseMarker,
  findMediaResponse,
  normalizeMediaResponsesForSave,
  parseMediaResponses,
  stripMediaResponseMarker,
  usableMediaResponses
} from "./mediaResponses.js";
import type { AiMediaResponse } from "../../types/ai.js";

const sample: AiMediaResponse[] = [
  {
    id: "abc123",
    label: "Tutorial",
    triggers: ["como instala", "não sei instalar"],
    text: "Segue o passo a passo",
    kind: "video",
    mediaUrl: "https://ex.com/v.mp4",
    filename: "v.mp4",
    enabled: true
  }
];

describe("mediaResponses", () => {
  it("parseMediaResponses descarta itens sem id", () => {
    const parsed = parseMediaResponses([
      { id: "a", triggers: ["x"], text: "oi", kind: "text" },
      { triggers: ["y"] } // sem id
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, "a");
  });

  it("usableMediaResponses exige gatilho e conteúdo, e respeita enabled", () => {
    const list: AiMediaResponse[] = [
      { ...sample[0] },
      { ...sample[0], id: "off", enabled: false },
      { ...sample[0], id: "notrig", triggers: [] },
      { ...sample[0], id: "empty", text: "", mediaUrl: "", kind: "text" }
    ];
    const usable = usableMediaResponses(list);
    assert.deepEqual(
      usable.map((r) => r.id),
      ["abc123"]
    );
  });

  it("extractMediaResponseMarker lê o id em formatos com espaço/caixa", () => {
    assert.equal(extractMediaResponseMarker("[[MIDIA:abc123]]"), "abc123");
    assert.equal(extractMediaResponseMarker("bla [[ midia : abc123 ]] bla"), "abc123");
    assert.equal(extractMediaResponseMarker("resposta normal sem marcador"), null);
  });

  it("stripMediaResponseMarker remove o marcador", () => {
    assert.equal(stripMediaResponseMarker("texto [[MIDIA:x]] fim").includes("MIDIA"), false);
  });

  it("findMediaResponse acha só utilizáveis", () => {
    assert.equal(findMediaResponse(sample, "abc123")?.label, "Tutorial");
    assert.equal(findMediaResponse(sample, "naoexiste"), null);
  });

  it("buildMediaResponsesBlock instrui o marcador e lista gatilhos", () => {
    const block = buildMediaResponsesBlock(sample);
    assert.match(block, /\[\[MIDIA:<id>\]\]/);
    assert.match(block, /abc123/);
    assert.match(block, /como instala/);
  });

  it("buildMediaResponsesBlock vazio quando não há resposta utilizável", () => {
    assert.equal(buildMediaResponsesBlock([]), "");
  });

  it("normalizeMediaResponsesForSave gera id e descarta linha vazia", () => {
    const saved = normalizeMediaResponsesForSave([
      { triggers: ["oi"], text: "olá", kind: "text" }, // sem id → gera
      { triggers: [], text: "", mediaUrl: "" } // vazia → descarta
    ]);
    assert.equal(saved.length, 1);
    assert.ok(saved[0].id.length > 0);
  });
});
