import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { plainWaMessageId, wahaMediaFileUrl } from "./waha.js";

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
});
