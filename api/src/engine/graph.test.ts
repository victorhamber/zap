import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getLinearNextNodeIds, getNextNodeId } from "./graph.js";
import type { FlowGraph } from "../types/flow.js";

const fanOutGraph: FlowGraph = {
  schemaVersion: 1,
  nodes: [
    { id: "t1", type: "trigger_custom_webhook", position: { x: 0, y: 0 }, data: {} },
    { id: "tag", type: "tag_action", position: { x: 200, y: -40 }, data: {} },
    { id: "mail", type: "send_email", position: { x: 200, y: 40 }, data: {} }
  ],
  edges: [
    { id: "e1", source: "t1", target: "tag" },
    { id: "e2", source: "t1", target: "mail" }
  ]
};

describe("graph fan-out", () => {
  it("retorna todas as saídas lineares paralelas", () => {
    assert.deepEqual(getLinearNextNodeIds(fanOutGraph, "t1"), ["tag", "mail"]);
  });

  it("getNextNodeId mantém compatibilidade (primeira saída)", () => {
    assert.equal(getNextNodeId(fanOutGraph, "t1"), "tag");
  });

  it("nó folha não tem próximo", () => {
    assert.deepEqual(getLinearNextNodeIds(fanOutGraph, "tag"), []);
  });
});
