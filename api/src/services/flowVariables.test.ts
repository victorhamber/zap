import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeFlowEmail } from "./flowVariables.js";

describe("flowVariables", () => {
  it("normaliza e-mail válido", () => {
    assert.equal(normalizeFlowEmail("  user@mail.com  "), "user@mail.com");
  });

  it("rejeita e-mail inválido ou vazio", () => {
    assert.equal(normalizeFlowEmail(""), "");
    assert.equal(normalizeFlowEmail("sem-arroba"), "");
    assert.equal(normalizeFlowEmail("@dominio.com"), "");
    assert.equal(normalizeFlowEmail("user@"), "");
  });
});
