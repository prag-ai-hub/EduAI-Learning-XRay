export { ApiError, toApiError } from "./errors";
export { createApiClient } from "./client";
export type { ApiClient, ApiClientOptions } from "./client";
export type {
  Paginated,
  School,
  SchoolRegistration,
  SchoolStatus,
} from "./types";

/*
 * Internal imports in this directory are relative, not `@/`-aliased, and must
 * stay that way. This package is bundled by the retiring `frontend/` workspace
 * too, whose `@/` maps to its own root - an alias here resolves in Metro and
 * fails in Vite. It is the one place in `app/src` where that rule applies.
 */
