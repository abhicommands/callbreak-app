export class HttpError extends Error {
  /** @param {number} status @param {string} message @param {Record<string, unknown> | null} data */
  constructor(status, message, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function assert(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
