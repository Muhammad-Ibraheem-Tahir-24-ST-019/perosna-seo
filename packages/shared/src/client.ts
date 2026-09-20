/**
 * Browser-safe subset of @indexpilot/shared.
 *
 * The main entry point pulls in node:crypto (password/token hashing) and Buffer
 * based cursor helpers, which must never be bundled into client code. The web
 * app imports this file instead: statuses, DTO types, error codes and the API
 * prefix - all pure data and pure functions.
 */
export * from './status.js';
export * from './types.js';
export * from './result.js';
export * from './tools.js';
export { API_PREFIX, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, API_KEY_PREFIX } from './constants.js';
export { ErrorCodes, type ErrorCode } from './errors.js';
