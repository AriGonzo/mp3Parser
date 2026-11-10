/**
 * An error that should be sent to the client with a specific HTTP status code.
 *
 * Route handlers throw these; the error-handling middleware in app.ts turns them into
 * a JSON response of the form { "error": message }.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
