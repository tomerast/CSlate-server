# Decision 003: Review Agent Pipeline — Full Deep Review

**Date:** 2026-03-28
**Status:** Accepted

## Context

When a component is uploaded from the client to CSlate-Server, a review agent must validate it before it enters the shared community database. The shared DB is a **curated, high-quality library** — every component that enters must be perfect.

## Decision: Full Deep Review (Level C)

**Every component undergoes a comprehensive, multi-stage review before it is discoverable by other users.** No shortcuts. No "good enough." The shared DB is the crown jewel of CSlate.

## Review Pipeline Stages

### Stage 1: Structural Validation
Automated checks (no LLM needed):
- Package conforms to the expected directory structure
- `manifest.json` exists and is valid JSON with all required fields
- All files referenced in `manifest.files` actually exist
- TypeScript compiles without errors
- No circular dependencies
- `index.ts` barrel exports match what's declared
- File naming follows conventions (`{name}.tsx`, `{name}.hook.ts`, etc.)

**Outcome:** Reject immediately if structural validation fails. Return specific errors to the client so the user/AI can fix.

### Stage 2: Security Analysis
Automated + LLM-assisted:
- **Static analysis** for known dangerous patterns:
  - No `eval()`, `Function()`, `innerHTML` with dynamic content
  - No direct DOM manipulation bypassing React
  - No network calls (`fetch`, `XMLHttpRequest`, `WebSocket`) unless declared in manifest
  - No filesystem access (`fs`, `path`, `child_process`)
  - No `window.location` redirects or `document.cookie` access
  - No obfuscated code or encoded payloads
  - No dynamic `import()` from external URLs
- **LLM review** for subtle security issues:
  - Does the code do what it claims? Or does it have hidden behavior?
  - Are there data exfiltration vectors disguised as normal logic?
  - XSS vulnerabilities in rendered content
  - Injection risks in any user-facing inputs

**Outcome:** Reject with detailed security report if any issues found. Zero tolerance.

### Stage 3: Code Quality Review
LLM-powered deep review:
- **UI/Logic separation**: Is business logic properly in `.hook.ts`? Is the `.tsx` file a pure presenter?
- **Type safety**: Are TypeScript types complete and correct? No `any` types, no type assertions without justification?
- **Component patterns**: Does it follow compound component pattern correctly (if applicable)? Are props well-designed?
- **Variants**: Are visual variants defined as structured data, not scattered conditionals?
- **Naming**: Are variable/function/component names clear and consistent?
- **Performance**: Any obvious performance issues? (unnecessary re-renders, missing memoization for expensive computations, large inline objects)
- **Accessibility**: Basic a11y checks (semantic HTML, ARIA labels, keyboard navigation)
- **Error handling**: Does the component handle edge cases (empty data, loading states, errors)?
- **Clean code**: No dead code, no commented-out code, no console.logs, no TODO/FIXME left behind

**Outcome:** If quality issues are found, the agent generates specific improvement suggestions. Minor issues → auto-fix and continue. Major issues → reject with actionable feedback.

### Stage 4: Context Verification
LLM reads `context/decisions.md` and verifies:
- Does the code actually implement what the user requested?
- Do the decisions documented match the code's behavior?
- Are there requirements mentioned in context that aren't reflected in code?
- Are there code behaviors not explained by the context?

**Outcome:** Flag discrepancies. If the code doesn't match stated intent, reject with explanation.

### Stage 5: Manifest Enrichment
LLM enhances the manifest for better discoverability:
- Verify/improve the `description` for clarity and searchability
- Verify/add `tags` — ensure comprehensive keyword coverage
- Verify `category` and `domain` assignments
- Verify `anatomy` accurately reflects the component's structure
- Verify `props` section is complete (no missing props, slots, or customization points)
- Generate/improve `ai.modificationHints` — specific, actionable guidance for future AI agents
- Generate/improve `ai.extensionPoints` — clearly document where/how to extend
- Set `ai.complexity` rating based on actual code analysis

**Outcome:** Updated manifest.json with enriched metadata. This is what makes the shared DB incredibly useful — expert-level documentation on every component.

### Stage 6: Embedding Generation
After all reviews pass:
- Generate vector embedding from: `description` + `tags` + `anatomy` + `context/decisions.md` summary
- This composite embedding captures both what the component IS and WHY it was built
- Store embedding in pgvector for semantic search

### Stage 7: Cataloging
Final step:
- Assign unique ID and version
- Store all package files
- Index in pgvector
- Update category/domain indices
- Component becomes discoverable by other users

## Pipeline Flow

```
Upload → Stage 1 (Structural) → Stage 2 (Security) → Stage 3 (Quality)
                                                            ↓
                                          Stage 4 (Context Verification)
                                                            ↓
                                          Stage 5 (Manifest Enrichment)
                                                            ↓
                                          Stage 6 (Embedding Generation)
                                                            ↓
                                          Stage 7 (Cataloging) → LIVE in shared DB
```

Early stages are fast/cheap (no LLM). Later stages are thorough/expensive (LLM).
If any stage fails, the pipeline stops and returns feedback to the client.

## Rejection Handling

When a component is rejected:
1. Server sends detailed feedback to the client (what failed, why, how to fix)
2. Client can show this to the user and/or have the local AI auto-fix issues
3. User can re-submit the improved component
4. Re-submission goes through the full pipeline again (no shortcuts)

## Quality Bar

The shared DB is a **curated library**, not a marketplace. The quality bar is:
- Would a senior developer approve this in a code review?
- Would an AI agent be able to understand and modify this without confusion?
- Is the manifest rich enough to find this component via natural language search?

If the answer to any of these is "no," the component does not enter the shared DB.

## Performance Considerations

- Stages 1-2 (structural + security static analysis): < 5 seconds
- Stages 3-5 (LLM review): 30-120 seconds depending on component complexity
- Stage 6 (embedding): < 5 seconds
- Stage 7 (cataloging): < 2 seconds
- **Total pipeline: ~1-3 minutes per component**

This is acceptable because:
- Upload is async — user doesn't wait
- User already has their component locally
- Quality is worth the wait
