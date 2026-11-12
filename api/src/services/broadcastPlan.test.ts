import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterGroupIds,
  groupDestinationsBeforeSend,
  groupGapMs,
  keepBroadcastGroupSend,
  parseBroadcastMedia,
  parseBroadcastParts,
  textToEmailHtml,
  GROUP_GAP_MAX_SEC,
  GROUP_GAP_MIN_SEC
} from "./broadcastPlan.js";

describe("cadência do broadcast", () => {
  it("cada pausa de grupo cai na faixa e não repete o mesmo valor", () => {
    const gaps = Array.from({ length: 12 }, () => groupGapMs());
    const min = GROUP_GAP_MIN_SEC * 1000 - 400;
    const max = GROUP_GAP_MAX_SEC * 1000 + 1200;
    for (const gap of gaps) {
      assert.ok(gap >= min && gap <= max, `pausa fora da faixa: ${gap}`);
    }
    assert.ok(new Set(gaps).size > 1);
  });

  it("o lote de grupos fica com a primeira execução", () => {
    assert.equal(keepBroadcastGroupSend(null, "run-a"), true);
    assert.equal(keepBroadcastGroupSend("run-a", "run-a"), true);
    assert.equal(keepBroadcastGroupSend("run-a", "run-b"), false);
  });

  it("junta texto e arquivos numa sequência", () => {
    const parts = parseBroadcastParts([
      { kind: "text", text: "Oi" },
      { kind: "image", url: "https://zap.exemplo/a.jpg", filename: "a.jpg", caption: "Legenda" },
      { kind: "video", url: "nota-url", filename: "v.mp4" }
    ]);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].kind, "text");
    assert.equal(parts[1].kind, "image");
  });

  it("aceita mídia por link http e recusa o resto", () => {
    assert.deepEqual(parseBroadcastMedia({ kind: "image", url: "https://zap.exemplo/a.jpg", filename: "a.jpg" }), {
      kind: "image",
      url: "https://zap.exemplo/a.jpg",
      filename: "a.jpg"
    });
    assert.equal(parseBroadcastMedia({ kind: "image", url: "data:image/png;base64,aaa" }), null);
    assert.equal(parseBroadcastMedia({ kind: "gif", url: "https://zap.exemplo/a.jpg" }), null);
  });

  it("o e-mail leva a imagem ou o link do arquivo", () => {
    assert.match(textToEmailHtml("Oi", { kind: "image", url: "https://zap.exemplo/a.jpg", filename: "a.jpg" }), /<img /);
    assert.match(
      textToEmailHtml("", { kind: "audio", url: "https://zap.exemplo/a.ogg", filename: "voz.ogg" }),
      /voz\.ogg/
    );
  });

  it("a mensagem depois do bloco de grupos aponta para o grupo escolhido", () => {
    const graph = {
      nodes: [
        { id: "t", type: "trigger_broadcast" },
        {
          id: "g",
          type: "send_groups",
          data: { groupIds: ["15@g.us", "nao-grupo"], groupLabels: { "15@g.us": "Grupo 15" } }
        },
        { id: "d", type: "delay" },
        { id: "m", type: "send_message" },
        { id: "p", type: "send_text" }
      ],
      edges: [
        { source: "t", target: "g" },
        { source: "g", target: "d" },
        { source: "d", target: "m" },
        { source: "t", target: "p" }
      ]
    };
    assert.deepEqual(groupDestinationsBeforeSend(graph, "m"), [{ id: "15@g.us", label: "Grupo 15" }]);
    assert.deepEqual(groupDestinationsBeforeSend(graph, "p"), []);
    assert.deepEqual(groupDestinationsBeforeSend(graph, "g"), []);
  });

  it("só aceita grupo @g.us, sem repetir", () => {
    assert.deepEqual(
      filterGroupIds([" 120@g.us ", "120@g.us", "5511@s.whatsapp.net", "99@newsletter", "88@g.us"]),
      ["120@g.us", "88@g.us"]
    );
  });
});
