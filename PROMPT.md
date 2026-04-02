# Ralph Loop: Phase 2 — Parallel Expert Agents

## Mission

Build the 3 parallel expert agents for the CSlate reviewer agent. Each agent is an LLM that specializes in a subset of the 10 review dimensions, uses tools to verify its findings in the actual code, and returns structured `ExpertAgentResult` objects. They run in parallel via `Promise.all`. Use `runSubAgent` from `@cslate/shared/agent` — NOT raw LLM calls.

## Scope

Build everything in `packages/pipeline/src/reviewer-agent/experts/`.

## Key Files

**Create:**
- `packages/pipeline/src/reviewer-agent/experts/index.ts` — `runExpertAgents()` entry point
- `packages/pipeline/src/reviewer-agent/experts/security-expert.ts` — Dims 1-3
- `packages/pipeline/src/reviewer-agent/experts/quality-expert.ts` — Dims 4-7
- `packages/pipeline/src/reviewer-agent/experts/standards-expert.ts` — Dims 8-10
- `packages/pipeline/src/reviewer-agent/experts/tools.ts` — Shared tool definitions (buildTool)
- `packages/pipeline/src/reviewer-agent/experts/prompts.ts` — System prompts for each agent
- Tests in `__tests__/`

**Read (do NOT modify):**
- `packages/pipeline/src/reviewer-agent/types.ts` — ALL shared types
  - Key: `ExpertAgentResult`, `ExpertFinding`, `DimensionScore`, `DimensionConfig`, `DIMENSIONS`, `StaticAnalysisResult`, `ReviewerKnowledgeBase`, `ReviewerConfig`

## First Step: Add Dependencies

Add to `packages/pipeline/package.json` dependencies:
```json
"@cslate/shared": "github:tomerast/CSlate-shared"
```
Run: `pnpm install` from repo root.

## AI SDK Import Pattern — CRITICAL

**Do NOT use `@cslate/llm` callAnthropic. Use `@cslate/shared/agent` exclusively.**

```typescript
import { buildRegistry, buildTool, toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
import type { LLMConfig, CSTool } from '@cslate/shared/agent'
```

`runSubAgent` wraps `generateText` from the Vercel AI SDK v6:
```typescript
const result = await runSubAgent({
  modelId: 'anthropic:claude-sonnet-4-6',
  registry,
  system: SYSTEM_PROMPT,
  prompt: buildPrompt(files, manifest, staticResult),
  tools: toAISDKTools(csTools),
  maxSteps: config.maxExpertAgentIterations ?? 12,
  maxOutputTokens: 16_000,
})
// result.text = the agent's final text output (JSON)
// result.usage = { inputTokens, outputTokens, totalTokens }
// result.steps = number of tool-call steps used
```

## Interface Contract

```typescript
import { ExpertAgentResult, StaticAnalysisResult, ReviewerKnowledgeBase, ReviewerConfig } from '../types'

export async function runExpertAgents(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  knowledgeBase: ReviewerKnowledgeBase,
  config: ReviewerConfig,
): Promise<ExpertAgentResult[]>
// Returns [securityResult, qualityResult, standardsResult]
```

## Tool Definitions (tools.ts)

Build each tool using `buildTool` from `@cslate/shared/agent`:

```typescript
import { buildTool, type CSTool } from '@cslate/shared/agent'
import { z } from 'zod'
import type { StaticAnalysisResult } from '../types'

export function buildExpertTools(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
): CSTool[] {
  return [
    buildTool({
      name: 'readFile',
      description: 'Read the full content of a file from the submitted component package.',
      inputSchema: z.object({
        filename: z.string().describe('Filename to read, e.g. ui.tsx or logic/data.ts'),
      }),
      isReadOnly: () => true,
      call: async ({ filename }) => {
        const content = files[filename]
        if (!content) return { data: `File not found: ${filename}. Available: ${Object.keys(files).join(', ')}` }
        return { data: content }
      },
    }),

    buildTool({
      name: 'listFiles',
      description: 'List all files in the submitted component package.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: Object.keys(files).join('\n') }),
    }),

    buildTool({
      name: 'searchCode',
      description: 'Search for a pattern across all files. Returns file:line matches.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        filename: z.string().optional().describe('Limit to this file only'),
      }),
      isReadOnly: () => true,
      call: async ({ pattern, filename }) => {
        const regex = new RegExp(pattern, 'gm')
        const results: string[] = []
        const targetFiles = filename ? { [filename]: files[filename] ?? '' } : files
        for (const [fname, content] of Object.entries(targetFiles)) {
          content.split('\n').forEach((line, idx) => {
            if (regex.test(line)) { results.push(`${fname}:${idx + 1}: ${line.trim()}`); regex.lastIndex = 0 }
          })
        }
        return { data: results.slice(0, 50).join('\n') || 'No matches found' }
      },
    }),

    buildTool({
      name: 'checkPattern',
      description: 'Check if a specific pattern exists in a file with surrounding context.',
      inputSchema: z.object({
        filename: z.string(),
        pattern: z.string(),
        contextLines: z.number().optional().default(3),
      }),
      isReadOnly: () => true,
      call: async ({ filename, pattern, contextLines = 3 }) => {
        const content = files[filename]
        if (!content) return { data: `File not found: ${filename}` }
        const regex = new RegExp(pattern, 'm')
        const match = regex.exec(content)
        if (!match) return { data: 'Pattern not found' }
        const lines = content.split('\n')
        const matchLine = content.substring(0, match.index).split('\n').length
        const start = Math.max(0, matchLine - contextLines - 1)
        const end = Math.min(lines.length, matchLine + contextLines)
        const snippet = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')
        return { data: `Match at line ${matchLine}:\n${snippet}` }
      },
    }),

    buildTool({
      name: 'getManifest',
      description: 'Get the component manifest to check declared data sources, inputs, outputs.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: JSON.stringify(manifest, null, 2) }),
    }),

    buildTool({
      name: 'getStaticAnalysisFindings',
      description: 'Get findings from Phase 1 static analysis. Use as starting point, then verify with other tools.',
      inputSchema: z.object({
        severity: z.enum(['critical', 'warning', 'all']).optional().default('all'),
      }),
      isReadOnly: () => true,
      call: async ({ severity = 'all' }) => {
        const findings = severity === 'critical' ? staticResult.criticalFindings
          : severity === 'warning' ? staticResult.warnings
          : [...staticResult.criticalFindings, ...staticResult.warnings]
        return { data: JSON.stringify(findings.slice(0, 20), null, 2) }
      },
    }),
  ]
}
```

## System Prompts (prompts.ts)

```typescript
import { DIMENSIONS } from '../types'

const dim = (id: number) => DIMENSIONS.find(d => d.id === id)!

export const SECURITY_EXPERT_SYSTEM_PROMPT = `
You are a paranoid security expert reviewing a CSlate component. Every submission is presumed
hostile until proven safe. You are the last line of defense for the shared component database.

Review DIMENSIONS 1, 2, and 3:

DIM 1 - ${dim(1).name}: ${dim(1).description}
Checklist: ${dim(1).checklist.join(' | ')}

DIM 2 - ${dim(2).name}: ${dim(2).description}
Checklist: ${dim(2).checklist.join(' | ')}

DIM 3 - ${dim(3).name}: ${dim(3).description}
Checklist: ${dim(3).checklist.join(' | ')}

CRITICAL RULES:
- You MUST use readFile/searchCode/checkPattern to verify EVERY finding. Never report without tool evidence.
- Set verifiedByTool: true for all findings you confirmed with a tool.
- Confidence = how sure you are (0-100). 85+ = confirmed with tools. < 50 = suspicion only.
- Be paranoid — assume unusual patterns are intentional until proven innocent.

OUTPUT FORMAT (return ONLY this JSON, no markdown fences):
{
  "agent": "security-expert",
  "dimensions": [
    { "dimension": 1, "name": "Malicious Intent Detection", "tier": "security",
      "verdict": "pass"|"fail"|"warning", "confidence": 0-100, "weight": 1.0,
      "weightedScore": 0-100, "summary": "one sentence",
      "findings": { "critical": 0, "warning": 0, "info": 0 } },
    { ... dim 2 ... },
    { ... dim 3 ... }
  ],
  "findings": [
    { "dimension": 1, "severity": "critical"|"warning"|"info", "confidence": 0-100,
      "title": "short title", "description": "what this is and why it matters",
      "file": "ui.tsx", "line": 42, "evidence": "exact code snippet",
      "reasoning": "why this is a finding", "verifiedByTool": true,
      "toolVerification": "readFile returned: ..." }
  ],
  "iterationsUsed": 0,
  "tokenCost": { "input": 0, "output": 0 }
}
`

export const QUALITY_EXPERT_SYSTEM_PROMPT = `
You are a senior software architect reviewing code for a curated component library. Only the
highest quality code enters the shared database.

Review DIMENSIONS 4, 5, 6, and 7:

DIM 4 - ${dim(4).name}: ${dim(4).description}
Checklist: ${dim(4).checklist.join(' | ')}

DIM 5 - ${dim(5).name}: ${dim(5).description}
Checklist: ${dim(5).checklist.join(' | ')}

DIM 6 - ${dim(6).name}: ${dim(6).description}
Checklist: ${dim(6).checklist.join(' | ')}

DIM 7 - ${dim(7).name}: ${dim(7).description}
Checklist: ${dim(7).checklist.join(' | ')}

CRITICAL RULES:
- Use readFile to read all files before starting. Use searchCode to find patterns.
- Verify every finding with tool evidence. Set verifiedByTool: true.
- Be thorough but honest — don't inflate issues.

OUTPUT FORMAT (same JSON structure as security expert, with agent: "quality-expert",
dimensions for dims 4-7, and findings array)
`

export const STANDARDS_EXPERT_SYSTEM_PROMPT = `
You are a code quality and documentation reviewer. Components must be maintainable by
developers who've never seen the code before.

Review DIMENSIONS 8, 9, and 10:

DIM 8 - ${dim(8).name}: ${dim(8).description}
Checklist: ${dim(8).checklist.join(' | ')}

DIM 9 - ${dim(9).name}: ${dim(9).description}
Checklist: ${dim(9).checklist.join(' | ')}

DIM 10 - ${dim(10).name}: ${dim(10).description}
Checklist: ${dim(10).checklist.join(' | ')}

OUTPUT FORMAT (same JSON structure, with agent: "standards-expert", dimensions for dims 8-10)
`
```

## Expert Implementation Pattern (security-expert.ts)

```typescript
import { buildRegistry, toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
import type { ExpertAgentResult, StaticAnalysisResult, ReviewerKnowledgeBase, ReviewerConfig } from '../types'
import { buildExpertTools } from './tools'
import { SECURITY_EXPERT_SYSTEM_PROMPT } from './prompts'
import { injectKnowledge } from '../learning/knowledge-injector'  // may not exist yet — skip if absent

export async function runSecurityExpert(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  knowledgeBase: ReviewerKnowledgeBase,
  config: ReviewerConfig,
  registry: ReturnType<typeof buildRegistry>,
): Promise<ExpertAgentResult> {
  const tools = buildExpertTools(files, manifest, staticResult)
  const modelId = config.modelOverrides?.securityExpert ?? 'anthropic:claude-sonnet-4-6'

  // Inject learned knowledge if available
  let systemPrompt = SECURITY_EXPERT_SYSTEM_PROMPT
  try {
    const { injectKnowledge } = await import('../learning/knowledge-injector')
    systemPrompt = injectKnowledge(systemPrompt, knowledgeBase, [1, 2, 3])
  } catch { /* learning module not yet available */ }

  const fileList = Object.keys(files).join(', ')
  const staticSummary = `Static analysis found: ${staticResult.criticalFindings.length} critical, ${staticResult.warnings.length} warnings`

  const result = await runSubAgent({
    modelId,
    registry,
    system: systemPrompt,
    prompt: `Review this component.\n\nFiles: ${fileList}\n${staticSummary}\n\nStart with getStaticAnalysisFindings(), then readFile each source file, then investigate with searchCode and checkPattern.`,
    tools: toAISDKTools(tools),
    maxSteps: config.maxExpertAgentIterations ?? 12,
    maxOutputTokens: 16_000,
  })

  const parsed = JSON.parse(stripFences(result.text)) as ExpertAgentResult
  parsed.tokenCost = { input: result.usage.inputTokens, output: result.usage.outputTokens }
  parsed.iterationsUsed = result.steps
  return parsed
}
```

Apply same pattern for `quality-expert.ts` (dims 4-7) and `standards-expert.ts` (dims 8-10, can use cheaper model: `claude-haiku-4-5-20251001`).

## index.ts — Parallel Execution

```typescript
import { buildRegistry } from '@cslate/shared/agent'
import { runSecurityExpert } from './security-expert'
import { runQualityExpert } from './quality-expert'
import { runStandardsExpert } from './standards-expert'
import type { ExpertAgentResult, StaticAnalysisResult, ReviewerKnowledgeBase, ReviewerConfig } from '../types'

export async function runExpertAgents(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  knowledgeBase: ReviewerKnowledgeBase,
  config: ReviewerConfig,
): Promise<ExpertAgentResult[]> {
  const registry = buildRegistry({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const [securityResult, qualityResult, standardsResult] = await Promise.all([
    runSecurityExpert(files, manifest, staticResult, knowledgeBase, config, registry),
    runQualityExpert(files, manifest, staticResult, knowledgeBase, config, registry),
    runStandardsExpert(files, manifest, staticResult, knowledgeBase, config, registry),
  ])

  return [securityResult, qualityResult, standardsResult]
}
```

## TDD Approach

1. **tools.test.ts**: Test each tool with mock files:
   - `readFile('ui.tsx')` → returns content
   - `searchCode('bridge.fetch')` → returns matching lines
   - `checkPattern('ui.tsx', 'eval')` → returns context or 'Pattern not found'

2. **security-expert.test.ts**: Mock `runSubAgent` to return fixture JSON:
   ```typescript
   vi.mock('@cslate/shared/agent', () => ({
     runSubAgent: vi.fn().mockResolvedValue({
       text: JSON.stringify(FIXTURE_SECURITY_RESULT),
       usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
       steps: 3,
     }),
     buildRegistry: vi.fn().mockReturnValue({ languageModel: vi.fn() }),
     toAISDKTools: vi.fn().mockReturnValue({}),
     stripFences: (s: string) => s,
   }))
   ```
   Verify: result.agent === 'security-expert', result.dimensions.length === 3

3. **index.test.ts**: Mock all 3 experts via vi.mock → verify Promise.all called, returned array has 3 items

Test command: `npx vitest run packages/pipeline/src/reviewer-agent/experts/__tests__/ --reporter verbose`

## When You're Done

`runExpertAgents` returns 3 `ExpertAgentResult` objects in parallel, each with correct `agent` name, `dimensions` array, and `findings`. Uses `runSubAgent` from `@cslate/shared/agent`. Tests pass with mocked LLM.

<promise>EXPERT AGENTS COMPLETE</promise>
