export const BRIDGE_API_SPEC = `
## CSlate Bridge API

Components interact with the platform exclusively through the bridge object:

### bridge.fetch(sourceId: string, params?: Record<string, unknown>): Promise<unknown>
- Fetches data from a declared data source
- sourceId MUST match a dataSources[].id in the manifest
- The platform proxies the actual HTTP request — component never sees the real URL
- Params are passed as query parameters to the proxied request

### bridge.subscribe(sourceId: string, callback: (data: unknown) => void): () => void
- Real-time subscription to a data source
- Returns an unsubscribe function
- Same sourceId restriction as bridge.fetch

### bridge.getConfig(key: string): string | undefined
- Reads user-provided configuration values
- Keys must match userConfig[].key in the manifest

## Sandbox Restrictions
- Components run in a sandboxed iframe
- No access to: window.require, process, __dirname, __filename, fs, child_process, cluster
- No access to: localStorage, sessionStorage, document.cookie
- No access to: fetch, XMLHttpRequest, WebSocket (must use bridge.fetch)
- window.postMessage restricted to parent frame communication
- No eval(), new Function(), or dynamic code execution
- Import statements resolve only to submitted files and allowed npm packages

## Side Channels
- Inline cards in the same Electron renderer process can create timing side-channels
- CSS custom properties are inherited (potential data channel)
- Error messages propagate to platform error handler (potential exfil channel)
- Component sizing and rendered output could encode steganographic data
`

export const PLATFORM_CONSTRAINTS = `
## What Is Blocked (enforced at runtime)
- Direct network access (fetch, XHR, WebSocket) — BLOCKED
- File system access — BLOCKED
- Process/child_process — BLOCKED
- Dynamic code execution (eval, Function constructor) — BLOCKED
- Node.js builtins — BLOCKED

## What Is Allowed
- React rendering (full React API)
- bridge.fetch/subscribe/getConfig (within manifest declarations)
- Declared events and actions (cross-component communication)
- CSS/Tailwind styling
- npm packages from allowlist

## Known Side-Channel Risks
1. CSS custom properties can encode data visible to parent frame
2. Error messages in thrown exceptions can encode data
3. Rendering timing differences can leak information
4. Image/SVG src attributes with data: URIs could encode payloads
5. Console output is captured by platform logger
`
