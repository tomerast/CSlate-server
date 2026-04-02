# Ralph Loop: Learning System + DB Schema

## Mission

Build the continuous learning system for the CSlate reviewer agent. This includes the Drizzle ORM database schemas, the knowledge base loader, outcome recorder, standards distillation job, and knowledge injector. The system makes the reviewer agent improve over time by learning from review outcomes.

## Scope

Build DB schemas in `packages/db/src/schema/reviewer-*.ts` and learning logic in `packages/pipeline/src/reviewer-agent/learning/`.

## Key Files

**Create:**
- `packages/db/src/schema/reviewer-standards.ts`
- `packages/db/src/schema/reviewer-patterns.ts`
- `packages/db/src/schema/review-outcomes.ts`
- `packages/db/src/schema/review-corrections.ts`
- `packages/db/src/schema/reviewer-dimension-weights.ts`
- `packages/db/src/schema/reviewer-knowledge-versions.ts`
- Update `packages/db/src/schema/index.ts` to export all new schemas
- `packages/pipeline/src/reviewer-agent/learning/index.ts` — `loadKnowledgeBase()` entry
- `packages/pipeline/src/reviewer-agent/learning/outcome-recorder.ts` — `recordReviewOutcome()`
- `packages/pipeline/src/reviewer-agent/learning/distillation.ts` — `runDistillation()` weekly job
- `packages/pipeline/src/reviewer-agent/learning/knowledge-injector.ts` — `injectKnowledge()`
- Tests for each module

**Read (do NOT modify):**
- `packages/pipeline/src/reviewer-agent/types.ts` — LearnedStandard, PatternEntry, ReviewOutcome, ReviewCorrection, DimensionWeight, ReviewerKnowledgeBase, ReviewVerdict
- `packages/db/src/schema/uploads.ts` — Drizzle schema pattern to follow
- `packages/db/src/schema/pipelines.ts` — Another schema pattern example
- `packages/db/src/client.ts` — `Db` type (`type Db = ReturnType<typeof getDb>`)
- `packages/db/src/schema/index.ts` — Where to add new schema exports

## Drizzle Schema Pattern

Follow EXACTLY the pattern from `packages/db/src/schema/uploads.ts`:

```typescript
import { pgTable, uuid, text, integer, real, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const reviewerStandards = pgTable('reviewer_standards', {
  id: text('id').primaryKey(),
  dimension: integer('dimension').notNull(),
  rule: text('rule').notNull(),
  rationale: text('rationale').notNull(),
  examplesGood: jsonb('examples_good').default([]),
  examplesBad: jsonb('examples_bad').default([]),
  source: text('source').notNull(),            // 'manual' | 'learned'
  confidence: real('confidence').default(50),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
}, (table) => [
  index('idx_reviewer_standards_dimension').on(table.dimension),
])

export type ReviewerStandard = typeof reviewerStandards.$inferSelect
export type NewReviewerStandard = typeof reviewerStandards.$inferInsert
```

Apply same pattern for all 6 tables.

## All 6 DB Schemas

### reviewer-patterns.ts
```typescript
export const reviewerPatterns = pgTable('reviewer_patterns', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),          // 'approved' | 'rejected' | 'suspicious'
  patternDesc: text('pattern_desc').notNull(),
  regex: text('regex'),
  dimension: integer('dimension').notNull(),
  occurrences: integer('occurrences').notNull().default(0),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  examples: jsonb('examples').default([]),
})
```

### review-outcomes.ts
```typescript
export const reviewOutcomes = pgTable('review_outcomes', {
  id: text('id').primaryKey(),
  uploadId: text('upload_id').notNull(),
  verdict: text('verdict').notNull(),       // 'approved' | 'rejected'
  dimensionScores: jsonb('dimension_scores').notNull(),
  findings: jsonb('findings').notNull(),
  postReviewSignals: jsonb('post_review_signals'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_review_outcomes_upload').on(table.uploadId),
  index('idx_review_outcomes_verdict').on(table.verdict),
])
```

### review-corrections.ts
```typescript
export const reviewCorrections = pgTable('review_corrections', {
  id: text('id').primaryKey(),
  reviewId: text('review_id').notNull(),
  findingId: text('finding_id').notNull(),
  correctionType: text('correction_type').notNull(),  // 'false_positive' | 'false_negative' | 'severity_wrong'
  originalSeverity: text('original_severity').notNull(),
  originalDimension: integer('original_dimension').notNull(),
  correctedSeverity: text('corrected_severity').notNull(),
  correctedDimension: integer('corrected_dimension').notNull(),
  reason: text('reason').notNull(),
  correctedBy: text('corrected_by').notNull(),   // 'admin' | 'outcome'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

### reviewer-dimension-weights.ts
```typescript
export const reviewerDimensionWeights = pgTable('reviewer_dimension_weights', {
  id: text('id').primaryKey(),
  dimension: integer('dimension').notNull(),
  weight: real('weight').notNull().default(1.0),
  strictnessLevel: text('strictness_level').notNull().default('standard'),
  adjustedAt: timestamp('adjusted_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason').notNull(),
}, (table) => [
  index('idx_dimension_weights_dim').on(table.dimension),
])
```

### reviewer-knowledge-versions.ts
```typescript
export const reviewerKnowledgeVersions = pgTable('reviewer_knowledge_versions', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  changeType: text('change_type').notNull(),     // 'standard_added' | 'weight_changed' | 'pattern_added'
  changeDescription: text('change_description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

## Interface Contracts

```typescript
import type { Db } from '@cslate/db'
import { ReviewerKnowledgeBase, ReviewVerdict } from '../types'

// Load current knowledge base from DB (with safe defaults if DB is empty)
export async function loadKnowledgeBase(db: Db): Promise<ReviewerKnowledgeBase>

// Record a review outcome after every review
export async function recordReviewOutcome(db: Db, verdict: ReviewVerdict, uploadId: string): Promise<void>

// Run weekly distillation (called by pg-boss scheduled job)
export async function runDistillation(db: Db, windowDays?: number): Promise<void>

// Inject knowledge into an agent system prompt
export function injectKnowledge(
  basePrompt: string,
  knowledgeBase: ReviewerKnowledgeBase,
  dimensions: number[],
): string
```

## Implementation Details

### loadKnowledgeBase (index.ts)

```typescript
export async function loadKnowledgeBase(db: Db): Promise<ReviewerKnowledgeBase> {
  const [standards, patterns, weights, versionRow] = await Promise.all([
    db.select().from(reviewerStandards).where(isNull(reviewerStandards.retiredAt)),
    db.select().from(reviewerPatterns),
    db.select().from(reviewerDimensionWeights).orderBy(desc(reviewerDimensionWeights.adjustedAt)),
    db.select({ version: max(reviewerKnowledgeVersions.version) }).from(reviewerKnowledgeVersions),
  ])

  return {
    version: versionRow[0]?.version ?? 0,
    updatedAt: new Date(),
    codeStandards: standards.map(mapStandard),
    patternLibrary: patterns.map(mapPattern),
    dimensionWeights: deduplicateWeights(weights),
  }
}
```

### recordReviewOutcome (outcome-recorder.ts)

```typescript
export async function recordReviewOutcome(db: Db, verdict: ReviewVerdict, uploadId: string): Promise<void> {
  const id = crypto.randomUUID()
  await db.insert(reviewOutcomes).values({
    id,
    uploadId,
    verdict: verdict.decision,
    dimensionScores: verdict.scorecard,
    findings: verdict.findings,
    createdAt: new Date(),
  })
}
```

### injectKnowledge (knowledge-injector.ts)

```typescript
export function injectKnowledge(
  basePrompt: string,
  kb: ReviewerKnowledgeBase,
  dimensions: number[],
): string {
  const relevantStandards = kb.codeStandards
    .filter(s => dimensions.includes(s.dimension))
    .filter(s => s.confidence > 30)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20)

  const relevantPatterns = kb.patternLibrary
    .filter(p => dimensions.includes(p.dimension) && p.type === 'rejected')
    .slice(0, 10)

  if (relevantStandards.length === 0 && relevantPatterns.length === 0) return basePrompt

  let injection = '\n\n## Learned Standards for This Review\n'
  for (const s of relevantStandards) {
    injection += `- [Dim ${s.dimension}] ${s.rule} (confidence: ${s.confidence}%)\n`
  }

  if (relevantPatterns.length > 0) {
    injection += '\n## Known Bad Patterns to Watch For\n'
    for (const p of relevantPatterns) {
      injection += `- [Dim ${p.dimension}] ${p.patternDesc}\n`
    }
  }

  return basePrompt + injection
}
```

### runDistillation (distillation.ts)

```typescript
export async function runDistillation(db: Db, windowDays = 30): Promise<void> {
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000)
  const outcomes = await db.select().from(reviewOutcomes)
    .where(gte(reviewOutcomes.createdAt, since))

  // Safety rails:
  // 1. Minimum 3 confirming reviews before learning a new standard
  // 2. Security dimensions (1-3) weights can only tighten (increase), never loosen
  // 3. Dimension weight bounds: 0.5 - 2.0 without admin override
  // 4. Every mutation creates a version record

  // Distillation logic: find findings that appeared 3+ times in rejected components
  // → candidate new standards
  // Find findings that appeared in approved components → increase confidence of existing
  // ... (implement per spec Section 7)
}
```

## Safety Rails in Distillation

1. Minimum 3 confirming reviews before learning a new standard
2. Standards not confirmed in 90 days lose confidence (decay)
3. Security dimension (1-3) weights: can only increase (tighten), never decrease
4. Dimension weight bounds: 0.5 - 2.0 without admin override
5. Every mutation creates a `reviewer_knowledge_versions` record

## TDD Approach

1. **schema.test.ts**: Verify each schema compiles with correct column types (just import — TypeScript will verify)
2. **knowledge-injector.test.ts**: Test with mock KB → verify standards injected, empty KB returns basePrompt unchanged
3. **outcome-recorder.test.ts**: Test with mock DB (vitest mock) → verify insert called with correct shape
4. **index.test.ts**: Test loadKnowledgeBase with empty DB → returns defaults (version 0, empty arrays)
5. **distillation.test.ts**: Test with 3+ identical findings → verify candidate standard created

Test command: `npx vitest run packages/pipeline/src/reviewer-agent/learning/__tests__/ --reporter verbose`

## When You're Done

All 6 DB schemas defined following Drizzle patterns, knowledge loader returns safe defaults, outcome recorder stores verdicts, knowledge injector adds relevant standards to prompts, distillation safety rails enforced, tests pass.

<promise>LEARNING SYSTEM COMPLETE</promise>
