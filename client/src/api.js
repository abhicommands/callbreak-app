export const ledgerPath = (id) => `/api/ledger/${id}`;
export const editorStorageKey = (id) => `callbreak:editor:${id}`;
export const recoveryStorageKey = (id) => `callbreak:recovery:${id}`;

export function randomHex(length) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function request(path, { token, body, key, signal } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers["Idempotency-Key"] = key;
  if (body) headers["Content-Type"] = "application/json";
  const options = { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body), signal };
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(path, options);
      if (!key || ![502, 503, 504].includes(response.status) || attempt === 1) break;
    } catch (error) {
      if (!key || attempt === 1 || signal?.aborted) throw error;
    }
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Ledger request failed.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export function setupLedger(payload, action) {
  const seriesId = randomHex(16);
  const editorKey = randomHex(32);
  const recoveryKey = randomHex(32);
  const key = crypto.randomUUID();
  return {
    seriesId,
    editorKey,
    recoveryKey,
    submit: () => request(`${ledgerPath(seriesId)}/setup`, {
      token: editorKey,
      key,
      body: { expectedRevision: 0, action, payload, recoveryKey },
    }),
  };
}
