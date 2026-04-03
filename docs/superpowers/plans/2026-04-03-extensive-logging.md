# Extensive Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared `@cslate/logger` package and instrument every critical path — pipeline stages, reviewer-agent phases, LLM calls, worker handlers, auth middleware, and the uploads route — so the full upload flow is traceable in local dev.

**Architecture:** A new `packages/logger` workspace package exports a `createLogger(module)` factory backed by a single pino root instance. Every package and app imports from `@cslate/logger` instead of creating their own pino instances. The `module` field on every log line enables per-subsystem filtering.

**Tech Stack:** pino ^9.5.0, pino-pretty ^11.3.0, TypeScript, pnpm workspaces

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| CREATE | `packages/logger/package.json` | New shared logger package |
| CREATE | `packages/logger/tsconfig.json` | TS config extending base |
| CREATE | `packages/logger/src/index.ts` | `createLogger` factory + type export |
| MODIFY | `packages/llm/package.json` | Add `@cslate/logger` dep |
| MODIFY | `packages/llm/src/client.ts` | Log LLM API calls + timings |
| MODIFY | `packages/pipeline/package.json` | Add `@cslate/logger` dep |
| MODIFY | `packages/pipeline/src/runner.ts` | Log pipeline start/stage/done |
| MODIFY | `packages/pipeline/src/stages/1-manifest-validation.ts` | Log validation decisions |
| MODIFY | `packages/pipeline/src/stages/2-security-scan.ts` | Log pattern hits, URL flags, LLM verdict |
| MODIFY | `packages/pipeline/src/stages/3-dependency-check.ts` | Log blocked packages |
| MODIFY | `packages/pipeline/src/stages/4-quality-review.ts` | Log token violations, LLM verdict |
| MODIFY | `packages/pipeline/src/stages/5-test-render.ts` | Log TS compilation result |
| MODIFY | `packages/pipeline/src/stages/6-cataloging.ts` | Log LLM response, tags |
| MODIFY | `packages/pipeline/src/stages/7-embedding.ts` | Log embedding dims, component stored |
| MODIFY | `packages/pipeline/src/reviewer-agent/orchestrator.ts` | Log each phase + cost + verdict |
| MODIFY | `apps/api/package.json` | Add `@cslate/logger` dep, remove local pino |
| MODIFY | `apps/api/src/lib/logger.ts` | Re-export from `@cslate/logger` |
| MODIFY | `apps/api/src/middleware/auth.ts` | Log auth success/failure |
| MODIFY | `apps/api/src/routes/uploads.ts` | Log upload received + job enqueued |
| MODIFY | `apps/worker/package.json` | Add `@cslate/logger` dep, remove local pino |
| MODIFY | `apps/worker/src/index.ts` | Use shared logger |
| MODIFY | `apps/worker/src/handlers/review.ts` | Log job timing + progress |

---

## Task 1: Create `packages/logger`

**Files:**
- Create: `packages/logger/package.json`
- Create: `packages/logger/tsconfig.json`
- Create: `packages/logger/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
// packages/logger/package.json
{
  "name": "@cslate/logger",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs --dts",
    "dev": "tsup src/index.ts --format cjs --dts --watch"
  },
  "dependencies": {
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.3.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// packages/logger/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create src/index.ts**

```typescript
// packages/logger/src/index.ts
import pino from 'pino'

const root = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
    : undefined,
})

export function createLogger(module: string) {
  return root.child({ module })
}

export type Logger = ReturnType<typeof createLogger>
```

- [ ] **Step 4: Install deps and build**

```bash
cd /Users/tomerast/Projects/CSlate-server
pnpm install
pnpm --filter @cslate/logger build
```

Expected: `dist/index.js` and `dist/index.d.ts` created inside `packages/logger/`.

- [ ] **Step 5: Commit**

```bash
git add packages/logger/
git commit -m "feat(logger): add shared @cslate/logger package with createLogger factory"
```

---

## Task 2: Wire `@cslate/logger` into `packages/llm`

**Files:**
- Modify: `packages/llm/package.json`
- Modify: `packages/llm/src/client.ts`

- [ ] **Step 1: Add dependency**

In `packages/llm/package.json`, add to `"dependencies"`:
```json
"@cslate/logger": "workspace:*"
```

So the full `dependencies` block becomes:
```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.36.0",
  "@cslate/logger": "workspace:*",
  "openai": "^4.77.0"
}
```

- [ ] **Step 2: Replace `packages/llm/src/client.ts` with logged version**

```typescript
// packages/llm/src/client.ts
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { createLogger } from '@cslate/logger'

const log = createLogger('llm')

let _anthropic: Anthropic | null = null
let _openai: OpenAI | null = null

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

export function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

export async function callAnthropic(options: {
  model: string
  system: string
  prompt: string
  maxTokens?: number
}): Promise<string> {
  const start = Date.now()
  log.debug({ model: options.model, promptChars: options.prompt.length, maxTokens: options.maxTokens ?? 4096 }, 'llm call start')

  const client = getAnthropic()
  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      messages: [{ role: 'user', content: options.prompt }],
    })
  } catch (err) {
    log.warn({ model: options.model, promptChars: options.prompt.length, err }, 'llm call failed')
    throw err
  }

  const durationMs = Date.now() - start
  const inputTokens = message.usage.input_tokens
  const outputTokens = message.usage.output_tokens
  log.debug({ model: options.model, inputTokens, outputTokens, durationMs }, 'llm call done')

  const block = message.content[0]
  if (!block || block.type !== 'text') throw new Error('Unexpected LLM response type')
  return block.text
}

export async function getEmbedding(text: string): Promise<number[]> {
  const start = Date.now()
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'
  log.debug({ model, textChars: text.length }, 'embedding start')

  const client = getOpenAI()
  let res: Awaited<ReturnType<typeof client.embeddings.create>>
  try {
    res = await client.embeddings.create({ model, input: text })
  } catch (err) {
    log.warn({ model, textChars: text.length, err }, 'embedding failed')
    throw err
  }

  const embedding = res.data[0]?.embedding
  if (!embedding) throw new Error('No embedding returned')
  log.debug({ model, dims: embedding.length, durationMs: Date.now() - start }, 'embedding done')
  return embedding
}
```

- [ ] **Step 3: Install and build**

```bash
cd /Users/tomerast/Projects/CSlate-server
pnpm install
pnpm --filter @cslate/llm build
```

Expected: builds without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/llm/
git commit -m "feat(llm): add debug logging to callAnthropic and getEmbedding"
```

---

## Task 3: Add logging to the pipeline runner

**Files:**
- Modify: `packages/pipeline/package.json`
- Modify: `packages/pipeline/src/runner.ts`

- [ ] **Step 1: Add `@cslate/logger` to pipeline deps**

In `packages/pipeline/package.json`, add to `"dependencies"`:
```json
"@cslate/logger": "workspace:*"
```

- [ ] **Step 2: Replace `packages/pipeline/src/runner.ts`**

```typescript
// packages/pipeline/src/runner.ts
import { createLogger } from '@cslate/logger'
import { PipelineContext, PipelineResult, StageResult, ProgressCallback } from './types'
import { manifestValidation } from './stages/1-manifest-validation'
import { securityScan } from './stages/2-security-scan'
import { dependencyCheck } from './stages/3-dependency-check'
import { qualityReview } from './stages/4-quality-review'
import { testRender } from './stages/5-test-render'
import { cataloging } from './stages/6-cataloging'
import { embeddingAndStore } from './stages/7-embedding'
import { agentReview } from './reviewer-agent'

const log = createLogger('pipeline:runner')

const STAGES = [
  { name: 'manifest_validation', fn: manifestValidation },
  { name: 'dependency_check', fn: dependencyCheck },
  { name: 'agent_review', fn: agentReview },
  { name: 'cataloging', fn: cataloging },
  { name: 'embedding', fn: embeddingAndStore },
]

export async function runPipeline(
  ctx: PipelineContext,
  onProgress: ProgressCallback
): Promise<PipelineResult> {
  const pipelineStart = Date.now()

  // Smart retry: skip already-completed stages
  const completedStageNames = new Set(ctx.previousResults.map(r => r.stage))
  // Backward compatibility: old stage names count as agent_review already done
  if (completedStageNames.has('security_scan') || completedStageNames.has('quality_review')) {
    completedStageNames.add('agent_review')
  }

  const skipped = [...completedStageNames]
  const toRun = STAGES.filter(s => !completedStageNames.has(s.name)).map(s => s.name)
  log.info({ uploadId: ctx.uploadId, toRun, skipped }, 'pipeline start')

  for (const stage of STAGES) {
    if (completedStageNames.has(stage.name)) {
      log.debug({ uploadId: ctx.uploadId, stage: stage.name }, 'stage skipped (already complete)')
      continue
    }

    log.debug({ uploadId: ctx.uploadId, stage: stage.name }, 'stage start')
    await onProgress({ stage: stage.name, status: 'in_progress' })

    const result = await stage.fn(ctx)
    ctx.previousResults.push(result)

    log.debug({
      uploadId: ctx.uploadId,
      stage: stage.name,
      status: result.status,
      durationMs: result.duration,
      issueCount: result.issues?.length ?? 0,
    }, 'stage done')

    await onProgress({
      stage: stage.name,
      status: result.status === 'failed' ? 'failed' : 'complete',
      result,
      completedStages: ctx.previousResults,
    })

    if (result.status === 'failed') {
      const failedIssues = result.issues?.map(i => i.message) ?? []
      log.warn({ uploadId: ctx.uploadId, stage: stage.name, issues: failedIssues }, 'stage failed — pipeline rejected')
      log.info({ uploadId: ctx.uploadId, status: 'rejected', totalDurationMs: Date.now() - pipelineStart }, 'pipeline done')
      return {
        status: 'rejected',
        completedStages: ctx.previousResults,
      }
    }
  }

  log.info({ uploadId: ctx.uploadId, status: 'approved', totalDurationMs: Date.now() - pipelineStart }, 'pipeline done')
  return {
    status: 'approved',
    completedStages: ctx.previousResults,
  }
}
```

- [ ] **Step 3: Build pipeline**

```bash
pnpm --filter @cslate/pipeline build
```

Expected: builds without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/package.json packages/pipeline/src/runner.ts
git commit -m "feat(pipeline): add structured logging to runner"
```

---

## Task 4: Add logging to pipeline stages 1–4

**Files:**
- Modify: `packages/pipeline/src/stages/1-manifest-validation.ts`
- Modify: `packages/pipeline/src/stages/2-security-scan.ts`
- Modify: `packages/pipeline/src/stages/3-dependency-check.ts`
- Modify: `packages/pipeline/src/stages/4-quality-review.ts`

- [ ] **Step 1: Update stage 1 — manifest-validation**

Add after the existing imports at the top of `packages/pipeline/src/stages/1-manifest-validation.ts`:
```typescript
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:manifest-validation')
```

At the start of `manifestValidation`, add:
```typescript
log.debug({ uploadId: ctx.uploadId, fileCount: Object.keys(ctx.files).length }, 'manifest validation start')
```

Before the `return` on the Zod failure (after `parseResult.success` check):
```typescript
log.debug({ uploadId: ctx.uploadId, zodErrors: parseResult.error.issues.length }, 'manifest schema invalid')
```

At the bottom of the function, before the final `return`:
```typescript
const status = criticalIssues.length > 0 ? 'failed' : issues.some(i => i.severity === 'warning') ? 'warning' : 'passed'
log.debug({
  uploadId: ctx.uploadId,
  status,
  criticalCount: criticalIssues.length,
  warningCount: issues.filter(i => i.severity === 'warning').length,
  durationMs: Date.now() - start,
}, 'manifest validation done')
```

The final `return` statement already computes the same status — place the log line just before it:
```typescript
  const criticalIssues = issues.filter(i => i.severity === 'critical')
  const status = criticalIssues.length > 0 ? 'failed' : issues.some(i => i.severity === 'warning') ? 'warning' : 'passed'
  log.debug({
    uploadId: ctx.uploadId,
    status,
    criticalCount: criticalIssues.length,
    warningCount: issues.filter(i => i.severity === 'warning').length,
    durationMs: Date.now() - start,
  }, 'manifest validation done')
  return {
    stage: 'manifest_validation',
    status,
    duration: Date.now() - start,
    issues: issues.length > 0 ? issues : undefined,
  }
```

(Remove the duplicate `criticalIssues.length > 0 ? 'failed' : ...` inline expression in the original return — pull it into the `status` variable above.)

- [ ] **Step 2: Update stage 2 — security-scan**

Add after existing imports in `packages/pipeline/src/stages/2-security-scan.ts`:
```typescript
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:security-scan')
```

At the start of `securityScan`:
```typescript
log.debug({ uploadId: ctx.uploadId }, 'security scan start')
```

After the static pattern scan loop (after the `for (const [filename, content]...)` block):
```typescript
const patternHits = issues.filter(i => i.severity === 'critical').length
log.debug({ uploadId: ctx.uploadId, patternHits }, 'static pattern scan done')
```

After the URL validation loop (after `flaggedUrls` is populated):
```typescript
log.debug({ uploadId: ctx.uploadId, flaggedUrlCount: flaggedUrls.length }, 'url validation done')
```

After the LLM call for flagged URLs, add inside the `try` block after `const response = JSON.parse(responseText) as { verdict: string; issues: Issue[] }`:
```typescript
log.debug({ uploadId: ctx.uploadId, flaggedUrlCount: flaggedUrls.length, llmVerdict: response.verdict, newIssues: response.issues?.length ?? 0 }, 'url llm review done')
```

Before the final return:
```typescript
const criticalCount = issues.filter(i => i.severity === 'critical').length
log.debug({ uploadId: ctx.uploadId, criticalCount, durationMs: Date.now() - start }, 'security scan done')
```

- [ ] **Step 3: Update stage 3 — dependency-check**

Add after existing imports in `packages/pipeline/src/stages/3-dependency-check.ts`:
```typescript
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:dependency-check')
```

At the start of `dependencyCheck`:
```typescript
log.debug({
  uploadId: ctx.uploadId,
  npmDepCount: Object.keys(ctx.manifest.dependencies?.npmPackages ?? {}).length,
  cslateDepCount: (ctx.manifest.dependencies?.cslateComponents ?? []).length,
}, 'dependency check start')
```

After the npm allowlist loop:
```typescript
const blockedNpm = issues.filter(i => i.pattern && !i.message.includes('cslate')).map(i => i.pattern)
log.debug({ uploadId: ctx.uploadId, blockedNpm }, 'npm allowlist check done')
```

Before the final return:
```typescript
log.debug({ uploadId: ctx.uploadId, issueCount: issues.filter(i => i.severity === 'critical').length, durationMs: Date.now() - start }, 'dependency check done')
```

- [ ] **Step 4: Update stage 4 — quality-review**

Add after existing imports in `packages/pipeline/src/stages/4-quality-review.ts`:
```typescript
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:quality-review')
```

At the start of `qualityReview`:
```typescript
log.debug({ uploadId: ctx.uploadId }, 'quality review start')
```

After the Tailwind token scan loop:
```typescript
const tokenViolations = issues.filter(i => i.pattern === 'STYLING_TOKEN_VIOLATION').length
log.debug({ uploadId: ctx.uploadId, tokenViolations }, 'tailwind token scan done')
```

After `const response = JSON.parse(responseText) as { verdict: string; issues: Issue[] }` inside the `try` block:
```typescript
log.debug({ uploadId: ctx.uploadId, model, verdict: response.verdict, newIssues: response.issues?.length ?? 0 }, 'quality llm review done')
```

Before the final return:
```typescript
log.debug({ uploadId: ctx.uploadId, criticalCount: issues.filter(i => i.severity === 'critical').length, durationMs: Date.now() - start }, 'quality review done')
```

- [ ] **Step 5: Build and verify**

```bash
pnpm --filter @cslate/pipeline build
```

Expected: builds without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/stages/1-manifest-validation.ts \
        packages/pipeline/src/stages/2-security-scan.ts \
        packages/pipeline/src/stages/3-dependency-check.ts \
        packages/pipeline/src/stages/4-quality-review.ts
git commit -m "feat(pipeline): add debug logging to stages 1–4"
```

---

## Task 5: Add logging to pipeline stages 5–7

**Files:**
- Modify: `packages/pipeline/src/stages/5-test-render.ts`
- Modify: `packages/pipeline/src/stages/6-cataloging.ts`
- Modify: `packages/pipeline/src/stages/7-embedding.ts`

- [ ] **Step 1: Update stage 5 — test-render**

Add after existing imports in `packages/pipeline/src/stages/5-test-render.ts`:
```typescript
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:test-render')
```

At the start of `testRender`:
```typescript
log.debug({ uploadId: ctx.uploadId, fileCount: Object.keys(ctx.files).length }, 'test render start')
```

Before `return { stage: 'test_render', status: 'passed', ... }` (inside the `try` after the `await new Promise(...)` resolves):
```typescript
log.debug({ uploadId: ctx.uploadId, durationMs: Date.now() - start }, 'tsc compilation passed')
```

In the `catch` block, after `const issues: Issue[] = parseTypeScriptErrors(output)`:
```typescript
log.debug({ uploadId: ctx.uploadId, errorCount: issues.length, durationMs: Date.now() - start }, 'tsc compilation failed')
```

- [ ] **Step 2: Update stage 6 — cataloging**

Add after existing imports in `packages/pipeline/src/stages/6-cataloging.ts`:
```typescript
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:cataloging')
```

At the start of `cataloging`:
```typescript
log.debug({ uploadId: ctx.uploadId, model: process.env.LLM_CATALOG_MODEL ?? 'claude-haiku-4-5-20251001' }, 'cataloging start')
```

After `JSON.parse(responseText)` succeeds (after the `output` variable is set):
```typescript
log.debug({
  uploadId: ctx.uploadId,
  category: output.category,
  complexity: output.complexity,
  tagCount: output.tags.length,
  summaryChars: output.summary.length,
}, 'cataloging llm done')
```

In the `catch` block, add before the existing return:
```typescript
log.warn({ uploadId: ctx.uploadId, err }, 'cataloging failed')
```

- [ ] **Step 3: Update stage 7 — embedding**

Add after existing imports in `packages/pipeline/src/stages/7-embedding.ts`:
```typescript
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:embedding')
```

At the start of `embeddingAndStore` (inside the try, before `buildEmbeddingText`):
```typescript
log.debug({ uploadId: ctx.uploadId }, 'embedding start')
```

After `const embedding = await getEmbedding(embeddingText)`:
```typescript
log.debug({ uploadId: ctx.uploadId, embeddingDims: embedding.length }, 'embedding generated')
```

After `const similarTo = ...` is computed:
```typescript
log.debug({ uploadId: ctx.uploadId, similarCount: similarTo.length, similarTo }, 'similar components found')
```

After `const component = await createComponent(...)`:
```typescript
log.info({ uploadId: ctx.uploadId, componentId: component.id, componentName: ctx.manifest.name }, 'component stored')
```

In the `catch` block, before the existing return:
```typescript
log.warn({ uploadId: ctx.uploadId, err }, 'embedding/store failed')
```

- [ ] **Step 4: Build and verify**

```bash
pnpm --filter @cslate/pipeline build
```

Expected: builds without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/stages/5-test-render.ts \
        packages/pipeline/src/stages/6-cataloging.ts \
        packages/pipeline/src/stages/7-embedding.ts
git commit -m "feat(pipeline): add debug logging to stages 5–7"
```

---

## Task 6: Add logging to reviewer-agent orchestrator

**Files:**
- Modify: `packages/pipeline/src/reviewer-agent/orchestrator.ts`

- [ ] **Step 1: Add logger import**

Add after the existing imports (after the `import { DEFAULT_REVIEWER_CONFIG }` line):
```typescript
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:reviewer-agent')
```

- [ ] **Step 2: Log orchestrator entry and phase starts/ends**

At the start of `agentReview`, after `const phaseDurations = ...`:
```typescript
log.info({ uploadId: ctx.uploadId, componentName: (ctx.manifest as any).name }, 'agent review start')
```

After `Phase 1` completes (`phaseDurations.staticAnalysis = ...`), add:
```typescript
log.debug({
  uploadId: ctx.uploadId,
  phase: 'static_analysis',
  durationMs: phaseDurations.staticAnalysis,
  criticalFindings: staticResult.criticalFindings.length,
  warnings: staticResult.warnings.length,
}, 'phase done')
```

If static short-circuits, add before `return buildRejectResult(...)`:
```typescript
log.warn({ uploadId: ctx.uploadId, phase: 'static_analysis', criticalFindings: staticResult.criticalFindings.length }, 'short-circuit: critical static findings')
```

After `Phase 2` completes (`phaseDurations.expertAgents = ...`), add:
```typescript
log.debug({
  uploadId: ctx.uploadId,
  phase: 'expert_agents',
  durationMs: phaseDurations.expertAgents,
  totalFindings: totalExpertFindings,
  securityFailed: !!securityFailed,
}, 'phase done')
```

After `Phase 3` completes (inside the `else` branch, after `phaseDurations.redTeam = ...`):
```typescript
log.debug({
  uploadId: ctx.uploadId,
  phase: 'red_team',
  durationMs: phaseDurations.redTeam,
  threatLevel: redTeamResult.overallThreatLevel,
  exploitAttempts: redTeamResult.exploitAttempts.length,
}, 'phase done')
```

When red-team is skipped, add after the `await onProgress?.({ phase: 'red_team', status: 'skipped', ...})` call:
```typescript
log.debug({ uploadId: ctx.uploadId, phase: 'red_team' }, 'phase skipped — security already failed')
```

After `Phase 4` completes (`phaseDurations.judge = ...`), add:
```typescript
log.debug({
  uploadId: ctx.uploadId,
  phase: 'judge',
  durationMs: phaseDurations.judge,
  verifiedFindings: judgeResult.verifiedFindings.length,
  hallucinated: judgeResult.stats.hallucinated,
}, 'phase done')
```

After `Phase 5` verdict is computed (after `phaseDurations.verdict = ...`), add:
```typescript
const totalCost = costEntries.reduce((sum, e) => sum + e.estimatedCost, 0)
const totalTokens = costEntries.reduce((acc, e) => ({ input: acc.input + e.tokens.input, output: acc.output + e.tokens.output }), { input: 0, output: 0 })
log.info({
  uploadId: ctx.uploadId,
  decision: verdict.decision,
  decisionReason: verdict.decisionReason,
  totalDurationMs: Date.now() - startTime,
  phaseDurations,
  totalInputTokens: totalTokens.input,
  totalOutputTokens: totalTokens.output,
  estimatedCostUsd: totalCost.toFixed(4),
  hallucinationRate: stats.hallucinationRate.toFixed(2),
}, 'agent review done')
```

- [ ] **Step 3: Log retries in `withRetry`**

The `withRetry` helper is defined in the same file. Add a log inside the retry branch:

Find the `withRetry` function and update the retry path:
```typescript
async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = MAX_RETRIES): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries && isTransientError(err)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt)
        log.warn({ label, attempt, delay, err }, 'transient error — retrying')
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw err
    }
  }
  throw lastError
}
```

- [ ] **Step 4: Build and verify**

```bash
pnpm --filter @cslate/pipeline build
```

Expected: builds without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/reviewer-agent/orchestrator.ts
git commit -m "feat(pipeline): add phase logging to reviewer-agent orchestrator"
```

---

## Task 7: Update `apps/api` — shared logger, auth middleware, uploads route

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/lib/logger.ts`
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/routes/uploads.ts`

- [ ] **Step 1: Add `@cslate/logger` to api deps and remove local pino**

In `apps/api/package.json`:
- Add `"@cslate/logger": "workspace:*"` to `dependencies`
- Keep `pino` and `pino-pretty` — they are now owned by `@cslate/logger` but pnpm deduplicates; removing them is optional. If you want a clean dep list, remove `pino` and `pino-pretty` from `apps/api/package.json` since they're provided transitively.

- [ ] **Step 2: Replace `apps/api/src/lib/logger.ts`**

```typescript
// apps/api/src/lib/logger.ts
export { createLogger } from '@cslate/logger'
export type { Logger } from '@cslate/logger'

// Keep the default `log` export that existing code in apps/api uses
import { createLogger } from '@cslate/logger'
export const log = createLogger('api')
```

- [ ] **Step 3: Update `apps/api/src/middleware/auth.ts`**

```typescript
// apps/api/src/middleware/auth.ts
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { getUserByApiKeyHash } from '@cslate/db'
import { hashApiKey } from '../lib/auth-token'
import { log } from '../lib/logger'
import type { User } from '@cslate/db'

type Variables = {
  user: User
}

export const authMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('ApiKey ')) {
    log.warn({ path: c.req.path }, 'auth failed: missing or malformed Authorization header')
    throw new HTTPException(401, { message: 'AUTH_REQUIRED' })
  }
  const key = header.slice(7)
  const keyPrefix = key.slice(0, 12) + '...'
  const hash = hashApiKey(key)
  const user = await getUserByApiKeyHash(hash)
  if (!user) {
    log.warn({ path: c.req.path, keyPrefix }, 'auth failed: key not found')
    throw new HTTPException(401, { message: 'AUTH_REQUIRED' })
  }
  log.debug({ userId: user.id, keyPrefix, path: c.req.path }, 'auth ok')
  c.set('user', user)
  await next()
})
```

- [ ] **Step 4: Update `apps/api/src/routes/uploads.ts` — add upload + job logs**

In the `POST /upload` handler, after `await enqueueReviewJob({ uploadId: upload.id })` and before `return c.json(...)`, add:
```typescript
import { log } from '../lib/logger'
```
(Add this import at the top of the file alongside other imports.)

Then inside the handler:
```typescript
// After totalSize check passes, after createUpload resolves:
log.info({
  uploadId: upload.id,
  userId: user.id,
  componentName: manifest.name,
  fileCount: Object.keys(files).length,
  totalSizeBytes: totalSize,
}, 'upload received')

// After enqueueReviewJob:
log.info({ uploadId: upload.id, componentName: manifest.name }, 'review job enqueued')
```

- [ ] **Step 5: Install and build**

```bash
cd /Users/tomerast/Projects/CSlate-server
pnpm install
pnpm --filter @cslate/api build 2>/dev/null || true  # api may not have a build script; that's fine
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/
git commit -m "feat(api): wire shared logger, add auth middleware and upload route logging"
```

---

## Task 8: Update `apps/worker` — shared logger + enhanced handler logging

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/handlers/review.ts`

- [ ] **Step 1: Add `@cslate/logger` to worker deps**

In `apps/worker/package.json`, add to `dependencies`:
```json
"@cslate/logger": "workspace:*"
```

- [ ] **Step 2: Replace pino instance in `apps/worker/src/index.ts`**

Replace the pino import block:
```typescript
// OLD — remove these lines:
import pino from 'pino'
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
})
```

With:
```typescript
// NEW:
import { createLogger } from '@cslate/logger'
export const log = createLogger('worker')
```

- [ ] **Step 3: Enhance `apps/worker/src/handlers/review.ts`**

The handler currently has basic start/end logging. Add timing and progress detail:

After `log.info({ uploadId }, 'Starting review pipeline')`, add:
```typescript
const jobStart = Date.now()
log.debug({ uploadId, componentName: (upload?.manifest as any)?.name }, 'job details')
```

After `runPipeline` resolves (before the `if (result.status === 'approved')` block), add:
```typescript
const totalDurationMs = Date.now() - jobStart
```

Replace the existing `log.info({ uploadId }, 'Component approved')` with:
```typescript
log.info({ uploadId, totalDurationMs }, 'component approved')
```

Replace the existing `log.info({ uploadId, stages: ... }, 'Component rejected')` with:
```typescript
log.info({ uploadId, totalDurationMs, stages: result.completedStages.map(s => s.stage) }, 'component rejected')
```

In the catch block, before `log.error`, add:
```typescript
const totalDurationMs = Date.now() - jobStart
```
Then update `log.error({ uploadId, err }, ...)` to:
```typescript
log.error({ uploadId, totalDurationMs, err }, 'pipeline threw unexpected error')
```

- [ ] **Step 4: Install and verify TypeScript compiles**

```bash
cd /Users/tomerast/Projects/CSlate-server
pnpm install
pnpm --filter @cslate/worker typecheck 2>/dev/null || npx tsc --noEmit -p apps/worker/tsconfig.json
```

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/
git commit -m "feat(worker): wire shared logger and add timing to review handler"
```

---

## Task 9: Start dev server and verify logging

- [ ] **Step 1: Ensure .env.local is configured**

```bash
ls /Users/tomerast/Projects/CSlate-server/.env.local || cp .env.local.example .env.local
```

Make sure these keys are set in `.env.local`:
```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
LOG_LEVEL=debug
NODE_ENV=development
```

- [ ] **Step 2: Start the server**

```bash
cd /Users/tomerast/Projects/CSlate-server
pnpm dev
```

Expected startup sequence:
```
[api]    {"module":"api","level":30,"msg":"API server listening on http://localhost:3000"}
[worker] {"module":"worker","level":30,"msg":"Starting CSlate worker..."}
[worker] {"module":"worker","level":30,"msg":"Worker ready — listening for jobs"}
```

With pino-pretty in dev you'll see colorized output with the `module` field visible.

- [ ] **Step 3: Hit the health endpoint to verify HTTP logging**

```bash
curl http://localhost:3000/health
```

Expected in terminal:
```
GET /health 200 Xms   ← from honoLogger middleware
```

- [ ] **Step 4: Test auth logging**

```bash
curl -H "Authorization: ApiKey wrong_key" http://localhost:3000/api/v1/components
```

Expected log line from auth middleware:
```
WARN  [api] auth failed: key not found  keyPrefix=wrong_key... path=/api/v1/components
```

- [ ] **Step 5: Trigger an upload to trace the full pipeline**

```bash
curl -X POST http://localhost:3000/api/v1/components/upload \
  -H "Authorization: ApiKey cslate_dev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  -H "Content-Type: application/json" \
  -d '{"manifest":{"name":"test","title":"Test","description":"test","version":"1.0.0","tags":["test"],"files":["ui.tsx","logic.ts","types.ts","index.ts"]},"files":{"ui.tsx":"export default function T(){}","logic.ts":"","types.ts":"","index.ts":"export * from \"./ui\""}}'
```

Expected log sequence (in order):
```
INFO  [api]                    upload received  uploadId=... componentName=test
INFO  [api]                    review job enqueued  uploadId=...
INFO  [worker]                 Starting review pipeline  uploadId=...
INFO  [pipeline:runner]        pipeline start  uploadId=... toRun=[manifest_validation,...]
DEBUG [pipeline:runner]        stage start  stage=manifest_validation
DEBUG [pipeline:manifest-...]  manifest validation start  fileCount=4
DEBUG [pipeline:manifest-...]  manifest validation done  status=passed
DEBUG [pipeline:runner]        stage done  stage=manifest_validation status=passed
...
INFO  [pipeline:runner]        pipeline done  status=approved totalDurationMs=...
INFO  [worker]                 component approved  uploadId=... totalDurationMs=...
```
