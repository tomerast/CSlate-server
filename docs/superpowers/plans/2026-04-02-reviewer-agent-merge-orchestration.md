# Reviewer Agent — Merge Orchestration Guide

**Date:** 2026-04-02
**Purpose:** Orchestrate merging 7 worktree branches into main, with deep review at each step.

---

## Merge Order (Dependency-Respecting)

```
Step 1: feat/reviewer-learning          → main   (DB schema, no code deps)
Step 2: feat/reviewer-cost-control      → main   (config, depends on DB schema from step 1)
Step 3: feat/reviewer-static-analysis   → main   (Phase 1, no code deps)
Step 4: feat/reviewer-expert-agents     → main   (Phase 2, uses static types)
Step 5: feat/reviewer-red-team          → main   (Phase 3, uses expert types)
Step 6: feat/reviewer-judge-verdict     → main   (Phase 4-5, uses all prior types)
Step 7: feat/reviewer-orchestrator      → main   (wires everything, must be LAST)
```

---

## Pre-Merge Checklist (Run for EVERY branch)

### 1. Code Quality Gate
```bash
# In the worktree directory:
cd <worktree-path>

# TypeScript compilation
npx tsc --noEmit

# Lint
npm run lint

# Tests pass
npm test

# Check for console.logs, TODOs
grep -rn "console\.log\|console\.debug\|TODO\|FIXME\|HACK" packages/pipeline/src/reviewer-agent/
```

### 2. Interface Compliance
```bash
# Verify the branch uses shared types from reviewer-agent/types.ts
# and does NOT redefine any shared interfaces
grep -rn "export interface\|export type" packages/pipeline/src/reviewer-agent/ \
  --include="*.ts" \
  | grep -v "types.ts" \
  | grep -v "// local type"
```

Any exports from files other than `types.ts` should be implementation-specific, not shared contracts.

### 3. Test Coverage
- Each module must have unit tests
- Each public function must have at least one test
- Edge cases tested: empty input, malformed input, timeout scenarios

### 4. Prompt Quality Review
For branches that contain LLM prompts (expert-agents, red-team, judge-verdict):
- [ ] Prompts follow Slate/ref patterns (clear persona, explicit constraints, structured output format)
- [ ] Negative instructions included (what NOT to do)
- [ ] Output format explicitly specified with examples
- [ ] Token budget considered (prompts not excessively long)
- [ ] No hallucination-prone patterns (vague instructions, open-ended exploration)

---

## Per-Branch Deep Review

### Step 1: `feat/reviewer-learning`

**Files to review:**
- `packages/db/schema/reviewer-*.ts` — all new DB tables
- `packages/db/migrations/` — migration SQL
- `packages/pipeline/src/reviewer-agent/learning/` — all files

**Review checklist:**
- [ ] DB schema matches spec exactly (tables: reviewer_standards, reviewer_patterns, review_outcomes, review_corrections, reviewer_dimension_weights, reviewer_knowledge_versions)
- [ ] Indexes on frequently queried columns (dimension, type, created_at)
- [ ] JSONB columns for flexible data (examples_good, examples_bad, findings)
- [ ] Foreign key constraints correct
- [ ] Drizzle schema types match SQL migration
- [ ] Knowledge base loader handles empty DB gracefully
- [ ] Outcome recorder captures all ReviewVerdict fields
- [ ] Distillation job has minimum sample size guard (3+ reviews)
- [ ] Security dimensions (1-3) weight can only increase via learning
- [ ] Version history on every mutation

**Merge command:**
```bash
git checkout main
git merge feat/reviewer-learning --no-ff -m "feat(reviewer): add learning system DB schema and knowledge base"
npm test
```

---

### Step 2: `feat/reviewer-cost-control`

**Files to review:**
- `packages/db/schema/reviewer-config.ts` — config table
- `packages/pipeline/src/reviewer-agent/config/` — all files
- `packages/queue/src/reviewer-enqueue.ts` — rate-limited enqueue

**Review checklist:**
- [ ] ReviewerConfig matches spec defaults
- [ ] Rate limiter enforces maxReviewsPerHour at enqueue time
- [ ] Daily cost cap defers jobs to next day (not reject)
- [ ] Pause switch immediately stops new enqueues
- [ ] pg_notify listener for runtime config changes works
- [ ] Cost tracker records tokens per phase per review
- [ ] No hardcoded values — all from config table

**Merge command:**
```bash
git checkout main
git merge feat/reviewer-cost-control --no-ff -m "feat(reviewer): add admin cost control and rate limiting"
npm test
```

---

### Step 3: `feat/reviewer-static-analysis`

**Files to review:**
- `packages/pipeline/src/reviewer-agent/static/` — all files

**Review checklist:**
- [ ] Security scanner loads patterns from config/security-patterns.json
- [ ] Credential detector covers: API keys, tokens, bearer tokens, secret hashes
- [ ] URL validator uses existing allowlist/blocklist JSON files
- [ ] Tailwind checker catches raw color utilities
- [ ] AST analyzer produces correct CodeStructureMap for real component files
- [ ] TypeScript compiler runs in temp directory with bridge stubs
- [ ] Import validator detects circular dependencies
- [ ] Dead code detector finds unused exports
- [ ] runStaticAnalysis() returns correct StaticAnalysisResult shape
- [ ] Critical findings short-circuit correctly
- [ ] Performance: completes in < 5 seconds for typical component

**Merge command:**
```bash
git checkout main
git merge feat/reviewer-static-analysis --no-ff -m "feat(reviewer): add Phase 1 static analysis engine"
npm test
```

---

### Step 4: `feat/reviewer-expert-agents`

**Files to review:**
- `packages/pipeline/src/reviewer-agent/experts/` — all files

**Review checklist:**
- [ ] Agent loop engine follows Slate/ref query() pattern
- [ ] Tool definitions match spec (readFile, grep, queryAST, etc.)
- [ ] All tools are read-only and return bounded results
- [ ] Security Expert covers dimensions 1-3 with correct checklist
- [ ] Quality Expert covers dimensions 4-7 with correct checklist
- [ ] Standards Expert covers dimensions 8-10 with correct checklist
- [ ] Security Expert uses claude-sonnet-4-6, Standards uses haiku
- [ ] Iteration budgets enforced (15, 12, 8 respectively)
- [ ] Security Expert short-circuits on critical dim 1 finding
- [ ] Promise.all() dispatch for parallel execution
- [ ] Each agent returns ExpertAgentResult with correct shape
- [ ] Token cost tracked per agent
- [ ] System prompts follow Slate/ref patterns (persona, constraints, output format)
- [ ] Knowledge base standards injected into prompts when available

**Merge command:**
```bash
git checkout main
git merge feat/reviewer-expert-agents --no-ff -m "feat(reviewer): add Phase 2 parallel expert agents"
npm test
```

---

### Step 5: `feat/reviewer-red-team`

**Files to review:**
- `packages/pipeline/src/reviewer-agent/red-team/` — all files

**Review checklist:**
- [ ] Adversarial persona prompt is genuinely adversarial (not cooperative)
- [ ] All 8 attack vectors from spec are probed
- [ ] Bridge API spec tool returns accurate sandbox constraints
- [ ] Platform constraints tool returns accurate CSlate sandbox rules
- [ ] Feasibility levels correctly assigned (demonstrated vs plausible vs theoretical)
- [ ] Attack chains identified (finding A + B = exploit C)
- [ ] Only demonstrated/plausible findings flag for rejection
- [ ] RedTeamResult shape matches spec exactly
- [ ] Iteration budget enforced (10)
- [ ] Agent receives all Phase 2 findings as input

**Merge command:**
```bash
git checkout main
git merge feat/reviewer-red-team --no-ff -m "feat(reviewer): add Phase 3 adversarial red-team agent"
npm test
```

---

### Step 6: `feat/reviewer-judge-verdict`

**Files to review:**
- `packages/pipeline/src/reviewer-agent/judge/` — all files
- `packages/pipeline/src/reviewer-agent/verdict/` — all files

**Review checklist:**
- [ ] Judge verifies every critical/warning finding against actual code
- [ ] Hallucinated findings rejected with explanation
- [ ] Deduplication merges same-file/same-line findings
- [ ] Conflict resolution reads actual code to decide
- [ ] Severity can be adjusted up or down with reason
- [ ] Confidence adjusted based on evidence strength
- [ ] Info-level findings pass through unverified (cost optimization)
- [ ] JudgeResult stats are accurate (hallucination count, etc.)
- [ ] Verdict decision logic matches spec exactly:
  - Security fail = instant reject
  - Red-team high/critical = instant reject
  - Any critical finding = reject
  - Quality score below threshold = reject
  - Warning accumulation above threshold = reject
- [ ] Weighted average formula correct: sum(weight * confidence * verdictScore) / sum(weight)
- [ ] Report renderer produces correct markdown format
- [ ] Pipeline dimension mapping: dim 9 skipped for pipelines

**Merge command:**
```bash
git checkout main
git merge feat/reviewer-judge-verdict --no-ff -m "feat(reviewer): add Phase 4-5 judge agent and verdict synthesis"
npm test
```

---

### Step 7: `feat/reviewer-orchestrator`

**Files to review:**
- `packages/pipeline/src/reviewer-agent/orchestrator.ts`
- `packages/pipeline/src/runner.ts` (modified)
- `apps/worker/src/handlers/review.ts` (modified)

**Review checklist:**
- [ ] Orchestrator calls phases in correct order: static → experts → red-team → judge → verdict
- [ ] Phase 1 critical findings short-circuit (skip phases 2-5)
- [ ] Phase 2 security expert failure short-circuits (skip phases 3-5, but run verdict)
- [ ] Progress callback fired at each phase transition
- [ ] Config loaded from DB (or defaults)
- [ ] Knowledge base loaded and injected into agents
- [ ] Learning signals recorded after verdict
- [ ] Cost tracked across all phases
- [ ] Returns StageResult compatible with existing runner
- [ ] Runner stage order updated: manifest → dependency → agent_review → cataloging → embedding
- [ ] Old stages (security_scan, quality_review, test_render) deprecated
- [ ] Worker handler updated to use new stage
- [ ] Backward compatible: old stage names still work for resume logic

**Merge command:**
```bash
git checkout main
git merge feat/reviewer-orchestrator --no-ff -m "feat(reviewer): add orchestrator and runner integration"
npm test
```

---

## Post-Merge Integration Test

After ALL branches are merged, run the full integration test:

```bash
# 1. Build everything
npm run build

# 2. Run all tests
npm test

# 3. Manual integration test with a sample component
# (create a test script that submits a known-good and known-bad component)
npx tsx scripts/test-reviewer-agent.ts

# 4. Check that the old pipeline still works for pipeline reviews
# (pipeline review should use the new agent too)

# 5. Verify cost tracking
# Check that review_outcomes table is populated after a test review
```

---

## Conflict Resolution Strategy

**Most likely conflicts:**
- `packages/pipeline/src/index.ts` — multiple branches add exports
- `packages/db/schema/index.ts` — multiple branches add schema exports
- `packages/pipeline/src/runner.ts` — orchestrator branch modifies stage order

**Resolution approach:**
- For index.ts files: combine all exports (order doesn't matter)
- For runner.ts: orchestrator branch is authoritative (merge last)
- For types.ts: shared types file should NOT be modified by any branch. If it was, that's a bug — revert to main's version.

---

## Rollback Plan

If integration fails after partial merge:

```bash
# Find the commit before merges started
git log --oneline -20

# Reset to pre-merge state
git reset --hard <commit-before-first-merge>

# Fix the issue in the problematic worktree
cd <worktree-path>
# ... fix ...
git commit

# Re-merge from step 1
```

---

## Final Cleanup

After successful integration:

```bash
# Delete worktrees
git worktree remove ../CSlate-server-reviewer-static-analysis
git worktree remove ../CSlate-server-reviewer-expert-agents
git worktree remove ../CSlate-server-reviewer-red-team
git worktree remove ../CSlate-server-reviewer-judge-verdict
git worktree remove ../CSlate-server-reviewer-learning
git worktree remove ../CSlate-server-reviewer-cost-control
git worktree remove ../CSlate-server-reviewer-orchestrator

# Delete remote branches
git push origin --delete feat/reviewer-static-analysis
git push origin --delete feat/reviewer-expert-agents
git push origin --delete feat/reviewer-red-team
git push origin --delete feat/reviewer-judge-verdict
git push origin --delete feat/reviewer-learning
git push origin --delete feat/reviewer-cost-control
git push origin --delete feat/reviewer-orchestrator

# Prune
git worktree prune
git branch -d feat/reviewer-static-analysis feat/reviewer-expert-agents feat/reviewer-red-team feat/reviewer-judge-verdict feat/reviewer-learning feat/reviewer-cost-control feat/reviewer-orchestrator
```
