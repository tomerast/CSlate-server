# Decision 001: Component Package Structure

**Date:** 2026-03-28
**Status:** Pending

## Context

When the client uploads a finalized component to CSlate-Server, we need to define what a "component" looks like as a storable, searchable, reviewable, and AI-modifiable package.

Requirements:
- Separate UI from business logic cleanly
- Include all context (user decisions, conversation insights) as documentation
- Be easily modifiable by an AI coding agent
- Be robust and extensible
- Support semantic search and cataloging
- Be reviewable by the server's AI review agent

## Research Summary

Patterns studied: shadcn/ui registry model, Radix compound components, Bit.dev capsules, Storybook CSF, atomic design, feature-sliced design, headless UI, container/presenter.

### Key Insights

1. **shadcn/ui's registry model** is the closest existing pattern — a JSON manifest that makes components self-describing and database-storable
2. **Bit.dev's co-location** principle — everything about a component lives in one directory with predictable naming
3. **Radix's anatomy model** — documenting component structure (parts) in metadata, not just code
4. **Feature-sliced design** — forced separation of `ui/`, `model/`, `api/`, `lib/` within each feature
5. **Hook-based logic separation** — modern evolution of container/presenter, cleanest for AI comprehension

## Decision: Component Package Format

A component is a **self-contained package** (directory) with a strict, predictable structure:

```
{component-name}/
├── manifest.json                     # Machine-readable metadata (primary retrieval artifact)
├── context/
│   └── decisions.md                  # User conversation context, decisions, requirements
├── ui/
│   ├── {component-name}.tsx          # Primary UI (presenter)
│   ├── {component-name}.variants.ts  # Visual variants (structured, not conditionals)
│   └── parts/                        # Sub-components (compound pattern, if applicable)
│       ├── trigger.tsx
│       ├── content.tsx
│       └── item.tsx
├── logic/
│   ├── {component-name}.hook.ts      # Business logic / state / side effects
│   └── {component-name}.utils.ts     # Pure utility functions (if needed)
├── types/
│   └── {component-name}.types.ts     # TypeScript interfaces and prop types
├── examples/
│   └── {component-name}.examples.tsx # Usage examples (CSF-inspired)
└── index.ts                          # Barrel exports
```

### The Manifest (`manifest.json`)

The manifest is the **primary document** stored and indexed in the database. It must be sufficient for an AI agent to decide whether to use this component WITHOUT reading source code.

```json
{
  "name": "data-table",
  "title": "Data Table",
  "version": "1.0.0",
  "description": "A sortable, filterable, paginated table for displaying structured data.",

  "category": "organism",
  "domain": "data-display",
  "tags": ["table", "data", "grid", "sortable", "filterable"],

  "anatomy": {
    "root": "DataTable",
    "parts": ["Header", "Body", "Row", "Cell", "Pagination", "Toolbar"]
  },

  "props": {
    "primary": ["data", "columns", "onSort", "onFilter"],
    "customization": ["renderCell", "renderHeader", "emptyState"],
    "slots": ["toolbar", "pagination", "footer"]
  },

  "dependencies": {
    "registry": ["button", "input", "select"],
    "npm": ["@tanstack/react-table"]
  },

  "files": [
    { "path": "ui/data-table.tsx", "type": "component", "role": "presenter" },
    { "path": "logic/data-table.hook.ts", "type": "hook", "role": "logic" },
    { "path": "types/data-table.types.ts", "type": "types" },
    { "path": "context/decisions.md", "type": "context" }
  ],

  "ai": {
    "modificationHints": [
      "To add a new column type, extend ColumnDef in types.ts and add a case in renderCell",
      "Custom row actions go in the toolbar slot",
      "Sorting logic is in the hook — override useSorting for custom behavior"
    ],
    "extensionPoints": ["renderCell", "renderHeader", "toolbar slot", "custom column types"],
    "complexity": "high"
  },

  "origin": {
    "author": "user-id",
    "createdAt": "2026-03-28T10:00:00Z",
    "reviewedAt": "2026-03-28T10:05:00Z",
    "reviewStatus": "approved"
  }
}
```

### The Context Directory (`context/decisions.md`)

This is what makes CSlate unique. Every component carries the **conversation context** that created it:

```markdown
# Data Table — Design Decisions

## User Requirements
- Display product inventory with 500+ rows
- Must be sortable by any column
- Needs inline editing for price and stock columns
- Should export to CSV

## Key Decisions
- Used @tanstack/react-table for performance with large datasets
- Implemented virtual scrolling for 500+ rows
- Inline editing uses controlled inputs with debounced save
- CSV export handled by a utility function, not baked into the table

## Iteration Notes
- v1: Basic table, user wanted sorting → added column sort
- v2: User wanted inline editing → added editable cells
- v3: User wanted export → added CSV util
```

This allows the review agent to understand **why** the code is the way it is, and future AI agents to understand **what decisions were already made** when modifying the blueprint.

## Design Principles

1. **Manifest-first**: The JSON manifest is the source of truth for discovery and cataloging
2. **Predictable naming**: `{name}.tsx`, `{name}.hook.ts`, `{name}.types.ts` — no creativity in file names
3. **UI/Logic separation via hooks**: `.hook.ts` = all state and business logic; `.tsx` = pure presenter
4. **Documented anatomy**: Complex components declare their parts in the manifest
5. **Variants as data**: Use structured variant definitions, not scattered conditionals
6. **Context preservation**: Every component carries its conversation/decision history
7. **Flat over nested**: Use metadata tags for categorization, not deep directory hierarchies
8. **Examples are first-class**: Usage examples are co-located, not optional

## Server Implications

- **Storage**: manifest.json is indexed in pgvector (embedded for semantic search). Source files stored as blobs/files.
- **Review agent**: Can validate structure (does the package match the expected format?), check code quality, verify the manifest is accurate.
- **Cataloging**: Tags, category, domain, anatomy, and description from manifest feed the catalog.
- **Search**: Embedding generated from description + tags + anatomy + context/decisions.md
