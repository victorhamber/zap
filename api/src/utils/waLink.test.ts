import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildWaMeLink,
  matchWaLinkTrigger,
  normalizeWaLinkMessage
} from "../engine/executor.js";
import type { FlowGraph } from "../types/flow.js";

describe("normalizeWaLinkMessage", () => {
  it("colapsa espaços e lower-case", () => {
    assert.equal(normalizeWaLinkMessage("  Olá   Mundo  "), "olá mundo");
  });
});

describe("buildWaMeLink", () => {
  it("monta wa.me com text encoded", () => {
    const url = buildWaMeLink("5511999998888", "Olá! Vim do Instagram");
    assert.equal(
      url,
      "https://wa.me/5511999998888?text=" + encodeURIComponent("Olá! Vim do Instagram")
    );
  });
});

describe("matchWaLinkTrigger", () => {
  const graph: FlowGraph = {
    schemaVersion: 1,
    nodes: [
      {
        id: "t1",
        type: "trigger_wa_link",
        position: { x: 0, y: 0 },
        data: {
          message: "Olá! Vim pelo Instagram e quero o teste.",
          tags: ["Instagram"]
        }
      }
    ],
    edges: []
  };

  it("bate mensagem igual", () => {
    const r = matchWaLinkTrigger(graph, "Olá! Vim pelo Instagram e quero o teste.");
    assert.equal(r.matched, true);
    if (r.matched) assert.deepEqual(r.data.tags, ["Instagram"]);
  });

  it("bate com espaços extras", () => {
    const r = matchWaLinkTrigger(graph, "  Olá!  Vim pelo Instagram e quero o teste.  ");
    assert.equal(r.matched, true);
  });

  it("não bate texto diferente", () => {
    const r = matchWaLinkTrigger(graph, "Oi, tudo bem?");
    assert.equal(r.matched, false);
  });
});
