import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expectedReplyJobId } from "./chatState.js";

describe("chatState job id", () => {
  it("job id determinístico sem dois-pontos", () => {
    const id = expectedReplyJobId("zapeatrend", "5511999998888@c.us");
    assert.doesNotMatch(id, /:/);
    assert.match(id, /ai_reply/);
  });
});
