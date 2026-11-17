/** Base class for every error this library throws on purpose. */
export class DocEditError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'DocEditError';
  }
}
export class EncryptedPdfError extends DocEditError {
  constructor() { super('This PDF is protected with a password. Provide the password to open it.', 'ENCRYPTED'); }
}
export class BadPasswordError extends DocEditError {
  constructor() { super('The password is not correct.', 'BAD_PASSWORD'); }
}
export class InvalidPdfError extends DocEditError {
  constructor(cause?: unknown) { super(`Not a readable PDF${cause instanceof Error ? ': ' + cause.message : ''}`, 'INVALID_PDF'); }
}
export class PageRangeError extends DocEditError {
  constructor(message: string) { super(message, 'PAGE_RANGE'); }
}
export class NotImplementedError extends DocEditError {
  constructor(feature: string) { super(`${feature} is designed but not implemented yet (see docs/ROADMAP.md).`, 'NOT_IMPLEMENTED'); }
}
