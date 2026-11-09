export const CHECKPOINTS = Object.freeze(["読み込み", "情報取得", "ダウンロード", "変換"]);

export function checkpointItems(status) {
  const items = [];
  for (const step of CHECKPOINTS) {
    const state = status?.[step];
    if (state === "pass" || state === "fail") items.push({ step, state });
  }
  return items;
}

export function checkpointText(status) {
  return checkpointItems(status)
    .map((item) => `${item.step} ${item.state === "pass" ? "pass" : "失敗"}`)
    .join("\n");
}
