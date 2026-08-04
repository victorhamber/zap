import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contactHasLearnTags, phoneFromChatId, isGroupChatId } from "./tagGate.js";

describe("tagGate", () => {
  it("lista vazia de tags = todos elegíveis", async () => {
    assert.equal(await contactHasLearnTags("5511999999999", []), true);
  });

  it("extrai telefone do chatId", () => {
    assert.equal(phoneFromChatId("5511999999999@c.us"), "5511999999999");
  });

  it("detecta grupo", () => {
    assert.equal(isGroupChatId("120363@g.us"), true);
    assert.equal(isGroupChatId("5511999999999@c.us"), false);
  });
});
