import assert from "node:assert/strict";
import test from "node:test";
import { checkpointText } from "./checkpoints.mjs";

test("checkpoint text names only the finished steps", () => {
  const text = checkpointText({
    読み込み: "pass",
    情報取得: "pass",
    ダウンロード: "fail",
    detail: "Traceback (most recent call last):\n  at run (app.js:1:1)",
  });
  assert.equal(text, "読み込み pass\n情報取得 pass\nダウンロード 失敗");
  assert.equal(text.includes("Traceback"), false);
  assert.equal(text.includes("at "), false);
});

test("an empty run draws no checkpoint line", () => {
  assert.equal(checkpointText({}), "");
});
