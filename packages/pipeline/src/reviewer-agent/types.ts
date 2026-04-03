/**
 * Reviewer Agent — Shared Type Contracts (barrel re-export)
 *
 * Types are now organized in types/ sub-directory:
 *   dimensions.ts — DimensionTier, DimensionConfig, DIMENSIONS
 *   phases.ts     — Static analysis, expert, red-team, judge, agent loop types
 *   results.ts    — ReviewStats, ReviewCost, LearningSignal, ReviewVerdict
 *   learning.ts   — LearnedStandard, PatternEntry, DimensionWeight, KnowledgeBase
 *   config.ts     — ReviewerConfig, DEFAULT_REVIEWER_CONFIG, orchestrator types
 *
 * This file re-exports everything so existing imports (from './types' or '../types')
 * continue to work without changes.
 */

export * from './types/index'
