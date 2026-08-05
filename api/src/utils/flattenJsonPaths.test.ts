import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flattenJsonPaths, suggestWebhookFieldPath } from "./flattenJsonPaths.js";
import { extractCustomWebhookVariables } from "../engine/executor.js";

describe("flattenJsonPaths", () => {
  it("achata objetos aninhados", () => {
    const paths = flattenJsonPaths({
      buyer: { name: "Victor Hamber", phone: "5511999999999", email: "v@x.com" },
      order: { id: "ORD-1" }
    });
    const map = Object.fromEntries(paths.map((p) => [p.path, p.value]));
    assert.equal(map["$.buyer.name"], "Victor Hamber");
    assert.equal(map["$.buyer.phone"], "5511999999999");
    assert.equal(map["$.order.id"], "ORD-1");
  });

  it("sugere campos comuns", () => {
    const paths = flattenJsonPaths({
      customer: { full_name: "Ana", cellphone: "11988887777", email: "ana@mail.com" },
      id: "evt_99"
    });
    assert.match(suggestWebhookFieldPath(paths, "name"), /full_name|name/i);
    assert.match(suggestWebhookFieldPath(paths, "phone"), /cellphone|phone/i);
    assert.match(suggestWebhookFieldPath(paths, "email"), /email/i);
  });
});

describe("extractCustomWebhookVariables", () => {
  it("extrai name phone email", () => {
    const vars = extractCustomWebhookVariables(
      { data: { nome: "João Silva", tel: "+55 11 98888-7777", mail: "j@x.com" } },
      {
        namePath: "$.data.nome",
        phonePath: "$.data.tel",
        emailPath: "$.data.mail",
        externalIdPath: ""
      }
    );
    assert.equal(vars.name, "João");
    assert.equal(vars.fullName, "João Silva");
    assert.equal(vars.email, "j@x.com");
    assert.match(String(vars.phone), /5511988887777|11988887777/);
  });

  it("exige mapeamento de telefone", () => {
    assert.throws(
      () =>
        extractCustomWebhookVariables(
          { a: 1 },
          { namePath: "$.a", phonePath: "", emailPath: "" }
        ),
      /telefone|phonePath/i
    );
  });
});
