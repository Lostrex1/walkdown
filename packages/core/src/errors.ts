export type WalkdownErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_CONFIG"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "BROWSER_UNAVAILABLE"
  | "NAVIGATION_FAILED"
  | "CANCELLED"
  | "FILESYSTEM_ERROR";

export class WalkdownError extends Error {
  public constructor(
    public readonly code: WalkdownErrorCode,
    message: string,
    public readonly suggestion: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "WalkdownError";
  }
}
