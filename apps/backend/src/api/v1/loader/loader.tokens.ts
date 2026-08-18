/**
 * DI token for `LoaderSink` — a plain TS interface has no runtime identity,
 * so NestJS needs a token to inject by. Kept in its own file (not inline in
 * `loader-job.service.ts` or `loader.module.ts`) so both can import it
 * without one importing the other.
 */
export const LOADER_SINK = Symbol('LOADER_SINK');
