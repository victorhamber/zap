import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectGroupChats, plainWaMessageId, wahaMediaFileUrl } from "./waha.js";

describe("baixar mídia do WAHA", () => {
  it("separa o id cru do id completo do grupo", () => {
    assert.equal(
      plainWaMessageId("false_1203631757250104@g.us_3EB0ABC"),
      "3EB0ABC"
    );
    assert.equal(plainWaMessageId("3EB0ABC"), "3EB0ABC");
  });

  it("troca localhost de /api/files pelo WAHA_BASE_URL", () => {
    const url = wahaMediaFileUrl("http://localhost:3000/api/files/grupo.mp4");
    assert.match(url, /\/api\/files\/grupo\.mp4$/);
    assert.equal(url.includes("localhost"), false);
  });

  it("lê grupo com id objeto, mapa ou lista de chats", () => {
    assert.deepEqual(collectGroupChats([{ id: { _serialized: "1@g.us" }, subject: "EA" }]), [
      { id: "1@g.us", name: "EA" }
    ]);
    assert.deepEqual(collectGroupChats({ "2@g.us": { subject: "Oráculo" } }), [
      { id: "2@g.us", name: "Oráculo" }
    ]);
    assert.deepEqual(
      collectGroupChats({
        chats: [
          { id: "3@g.us", name: "Trend" },
          { id: "5511@c.us", name: "Pessoa" }
        ]
      }),
      [{ id: "3@g.us", name: "Trend" }]
    );
  });
});
