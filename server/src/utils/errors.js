export class HttpError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function assert(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}

export function asHttpError(err, fallbackStatus = 500, fallbackMessage = "Internal Server Error") {
  if (err instanceof HttpError) return err;
  const status = err?.status || fallbackStatus;
  const message = err?.message || fallbackMessage;
  return new HttpError(status, message, err?.data || null);
}
