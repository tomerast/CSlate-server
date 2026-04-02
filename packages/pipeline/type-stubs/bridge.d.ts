declare const bridge: {
  fetch: (sourceId: string, params?: Record<string, unknown>) => Promise<unknown>
  subscribe: (sourceId: string, callback: (data: unknown) => void) => () => void
  getConfig: (key: string) => string | undefined
}
