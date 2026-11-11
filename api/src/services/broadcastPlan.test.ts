import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterGroupIds,
  groupGapMs,
  parseBroadcastMedia,
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

  it("só aceita grupo @g.us, sem repetir", () => {
    assert.deepEqual(
      filterGroupIds([" 120@g.us ", "120@g.us", "5511@s.whatsapp.net", "99@newsletter", "88@g.us"]),
      ["120@g.us", "88@g.us"]
    );
  });
});
