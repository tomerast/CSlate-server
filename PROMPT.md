# Ralph Loop: Phase 3 — Adversarial Red-Team Agent

## Mission

Build the adversarial red-team agent for the CSlate reviewer agent. This is Phase 3 — a single LLM that thinks like an ATTACKER, probing for every possible way the submitted code could exploit the CSlate platform. It uses `runSubAgent` from `@cslate/shared/agent`.

## Scope

Build everything in `packages/pipeline/src/reviewer-agent/red-team/`.

## Key Files

**Create:**
- `packages/pipeline/src/reviewer-agent/red-team/index.ts` — `runRedTeam()` entry point
- `packages/pipeline/src/reviewer-agent/red-team/attack-vectors.ts` — 8 attack vector definitions
- `packages/pipeline/src/reviewer-agent/red-team/platform-spec.ts` — Bridge API spec + CSlate sandbox constraints
- `packages/pipeline/src/reviewer-agent/red-team/tools.ts` — Red-team specific tools
- `packages/pipeline/src/reviewer-agent/red-team/prompts.ts` — Adversarial system prompts
- Tests in `__tests__/`

**Read (do NOT modify):**
- `packages/pipeline/src/reviewer-agent/types.ts` — RedTeamResult, ExploitAttempt, ExploitFeasibility, ThreatLevel

## First Step: Add Dependencies

Add to `packages/pipeline/package.json`:
```json
"@cslate/shared": "github:tomerast/CSlate-shared"
```
Run: `pnpm install`

## AI SDK Import Pattern

**CRITICAL**: Use `@cslate/shared/agent` — NOT raw callAnthropic.

```typescript
import { buildRegistry, buildTool, toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
```

## Interface Contract

```typescript
import { RedTeamResult, StaticAnalysisResult, ExpertAgentResult, ReviewerConfig } from '../types'

export async function runRedTeam(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  config: ReviewerConfig,
): Promise<RedTeamResult>
```

## platform-spec.ts

```typescript
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
- Components on same canvas share Electron renderer process (timing side-channels)
- CSS custom properties are inherited (potential data channel)
- Error messages propagate to platform error handler (potential exfil channel)
- Component sizing/positioning could encode steganographic data
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
```

## tools.ts — Red-Team Specific Tools

Build on the base tools pattern but add attacker-perspective tools:

```typescript
import { buildTool } from '@cslate/shared/agent'
import { z } from 'zod'
import { BRIDGE_API_SPEC, PLATFORM_CONSTRAINTS } from './platform-spec'

export function buildRedTeamTools(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
) {
  return [
    buildTool({
      name: 'readFile',
      description: 'Read file content to find attack vectors.',
      inputSchema: z.object({ filename: z.string() }),
      isReadOnly: () => true,
      call: async ({ filename }) => {
        const content = files[filename]
        return { data: content ?? `File not found: ${filename}. Available: ${Object.keys(files).join(', ')}` }
      },
    }),

    buildTool({
      name: 'listFiles',
      description: 'List all submitted files.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: Object.keys(files).join('\n') }),
    }),

    buildTool({
      name: 'searchCode',
      description: 'Search for patterns that might indicate attack vectors.',
      inputSchema: z.object({
        pattern: z.string(),
        filename: z.string().optional(),
      }),
      isReadOnly: () => true,
      call: async ({ pattern, filename }) => {
        const regex = new RegExp(pattern, 'gm')
        const results: string[] = []
        const targetFiles = filename ? { [filename]: files[filename] ?? '' } : files
        for (const [fname, content] of Object.entries(targetFiles)) {
          const lines = content.split('\n')
          lines.forEach((line, idx) => {
            if (regex.test(line)) {
              results.push(`${fname}:${idx + 1}: ${line.trim()}`)
              regex.lastIndex = 0
            }
          })
        }
        return { data: results.join('\n') || 'No matches' }
      },
    }),

    buildTool({
      name: 'getBridgeAPISpec',
      description: 'Get the CSlate bridge API spec — what bridge.fetch/subscribe/getConfig can do, sandbox restrictions, and side-channel risks.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: BRIDGE_API_SPEC }),
    }),

    buildTool({
      name: 'getPlatformConstraints',
      description: 'Get CSlate platform security constraints: what is blocked, what is allowed, known side-channel risks.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: PLATFORM_CONSTRAINTS }),
    }),

    buildTool({
      name: 'getExpertFindings',
      description: 'Get all findings from Phase 2 expert agents — use as leads for deeper probing.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({
        data: JSON.stringify(
          expertResults.flatMap(r => r.findings.filter(f => f.severity !== 'info')),
          null, 2
        ),
      }),
    }),

    buildTool({
      name: 'getManifest',
      description: 'Get the component manifest to identify declared vs actual behavior mismatches.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: JSON.stringify(manifest, null, 2) }),
    }),
  ]
}
```

## prompts.ts — Adversarial System Prompt

```typescript
export const RED_TEAM_SYSTEM_PROMPT = `
You are a red-team security researcher. You have been given a component that will run inside
CSlate's Electron sandbox. Your mission: find every possible way this code could be used to
harm users, exfiltrate data, compromise the platform, or abuse the bridge API.

You are NOT a code reviewer. You are an ATTACKER. Think adversarially:
- "If I wanted to steal user data through this component, how would I do it?"
- "If I wanted to inject instructions into an AI agent that processes this component's context.md, what would I write?"
- "If I wanted to reach an endpoint not declared in dataSources, could I construct a bridge.fetch call that does it?"
- "If I wanted to affect other components on the canvas, could I abuse events/actions/shared state?"

=== ATTACK VECTORS TO PROBE (ordered by severity) ===
1. Sandbox escape — Can the code reach outside the sandbox?
2. Bridge API abuse — Dynamic source IDs, eavesdropping, config leaks?
3. Data exfiltration — CSS props, error messages, image tags, timing?
4. Prompt injection — Instructions in context.md targeting AI agents?
5. Cross-component attacks — Event/action injection, state poisoning?
6. Supply chain — Known vulnerable dependencies?
7. State persistence — Module-level closures, WeakMaps for cross-render persistence?
8. Timing/DoS — Infinite loops, memory exhaustion, CPU-bound freezing?

=== CRITICAL RULES ===
- You MUST use tools to verify every claim. Do NOT speculate without evidence.
- For each finding: cite file:line.
- Rate feasibility HONESTLY:
  - "demonstrated": The code ACTUALLY DOES this right now
  - "plausible": The code has building blocks; a small modification enables it
  - "theoretical": The architecture allows it but this code doesn't go there
- Only "demonstrated" and "plausible" are actionable. Be honest about theoretical.
- Use getBridgeAPISpec to understand what IS and ISN'T allowed before flagging.

=== OUTPUT FORMAT (return ONLY this JSON, no markdown) ===
{
  "exploitAttempts": [
    {
      "attackVector": "sandbox_escape"|"bridge_abuse"|"data_exfiltration"|"prompt_injection"|"cross_component"|"supply_chain"|"state_persistence"|"timing_dos",
      "technique": "specific technique description",
      "targetAsset": "what is being attacked",
      "feasibility": "theoretical"|"plausible"|"demonstrated",
      "evidence": "exact code or proof",
      "file": "filename.ts",
      "line": 42,
      "chainedWith": ["other attack vector if chained"],
      "mitigatedBy": "sandbox feature if mitigated"
    }
  ],
  "overallThreatLevel": "none"|"low"|"medium"|"high"|"critical",
  "sandboxEscapeRisk": 0-100,
  "dataExfiltrationRisk": 0-100,
  "supplyChainRisk": 0-100,
  "promptInjectionRisk": 0-100
}
`
```

## index.ts

```typescript
export async function runRedTeam(
  files, manifest, staticResult, expertResults, config
): Promise<RedTeamResult> {
  const registry = buildRegistry({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const tools = buildRedTeamTools(files, manifest, staticResult, expertResults)

  const result = await runSubAgent({
    modelId: config.modelOverrides.redTeam ?? 'anthropic:claude-sonnet-4-6',
    registry,
    system: RED_TEAM_SYSTEM_PROMPT,
    prompt: `Red-team this component. Files: ${Object.keys(files).join(', ')}. Start by reading context.md and manifest, then probe all 8 attack vectors methodically using your tools.`,
    tools: toAISDKTools(tools),
    maxSteps: config.maxRedTeamIterations ?? 10,
    maxOutputTokens: 16_000,
  })

  const parsed = JSON.parse(stripFences(result.text))
  return {
    ...parsed,
    iterationsUsed: result.steps,
    tokenCost: { input: result.usage.inputTokens, output: result.usage.outputTokens },
  } as RedTeamResult
}
```

## TDD Approach

1. **platform-spec.test.ts**: Verify BRIDGE_API_SPEC and PLATFORM_CONSTRAINTS are non-empty strings containing key terms
2. **attack-vectors.test.ts**: Verify all 8 attack vectors are covered in the system prompt
3. **tools.test.ts**: Test each tool with mock files → verify readFile, searchCode, getBridgeAPISpec return correct data
4. **index.test.ts**: Mock `runSubAgent` to return fixture RedTeamResult JSON → verify parsing and field mapping

Test command: `npx vitest run packages/pipeline/src/reviewer-agent/red-team/__tests__/ --reporter verbose`

## When You're Done

All attack vectors covered in prompts, tools built correctly, `runRedTeam` returns typed `RedTeamResult`, tests pass.

<promise>RED TEAM COMPLETE</promise>
