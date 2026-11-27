export function readTableSettings(form) {
  return {
    bidSeconds: form.has("bidSeconds") ? Number(form.get("bidSeconds")) : undefined,
    playSeconds: form.has("playSeconds") ? Number(form.get("playSeconds")) : undefined,
    weights: [0, 1, 2].map((index) => Number(form.get(`weight${index}`))),
    stake: Number(form.get("stake")),
    minimumBid: Number(form.get("minimumBid")),
  };
}
