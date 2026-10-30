// The Worker's bindings: `CONTROL_BASE_URL` is a var in wrangler.toml, the rest are secrets
// (`wrangler secret put`), never in the repository.
export type RouterEnv = {
  CONTROL_BASE_URL: string
  /** Same value as ORCA_ROUTER_KEY in the Control's .env. */
  ORCA_ROUTER_KEY: string
}

/** The slice of the Workers Cache API the router uses (caches.default in production). */
export type RouterCache = {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

export type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void
}

/** Injected in tests; production uses the global fetch and caches.default. */
export type RouterDeps = {
  fetch: typeof fetch
  cache: RouterCache
  now: () => number
}
