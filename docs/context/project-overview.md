# CSlate Project Overview (Server Context)

**Source:** Decisions from CSlate client repo (`github.com/tomerast/CSlate`)

## What is CSlate?

CSlate is an AI-powered app building platform combining:
- A **minimalist canvas** (the "Slate") — clean white/dark background
- A **conversational AI interface** — floating textbox triggered by shortcut key
- A **self-improving, crowdsourced component library** — shared database of community components

## Core User Flow

1. User opens CSlate → sees blank Slate
2. Shortcut key opens floating textbox
3. User describes desired component in natural language
4. AI agent searches shared component DB for close template matches
5. If match found → pulls source code → modifies to fit request
6. If no match → generates component from scratch
7. Component rendered live on Slate
8. User provides feedback → AI iterates until satisfied
9. Final component source code async uploaded to **CSlate-Server**
10. Server review agent validates code (security, quality, logic)
11. Component is embedded, summarized, and cataloged for future users

## Target Users

- Non-technical users who want to "vibe code" their ideal application
- Plugin support for external data sources enables unlimited creation possibilities

## App Model

- Apps = multiple tabs, each tab is a Slate containing components
- Components live on a structured dense dynamic grid (responsive layout)
- Components are not just visual — they are dynamic, flexible, and can interact

## Tech Stack

- **Client:** Electron + TypeScript + React (desktop-first)
- **Server:** TypeScript
- **AI:** User-configurable LLM provider on client side; server runs its own review agent
- **Database:** pgvector for semantic component search

## Architecture Split

| Concern | Owner |
|---|---|
| Electron shell, window management | Client |
| Slate canvas + grid layout | Client |
| Floating AI textbox | Client |
| Component rendering + sandboxing | Client |
| Local AI agent (user-configured LLM) | Client |
| Iterative component refinement loop | Client |
| Component upload (async) | Client → **Server** |
| Component search/retrieval | Client ← **Server** |
| **Code review agent** | **Server** |
| **Embedding generation** | **Server** |
| **Cataloging + summarization** | **Server** |
| **pgvector database** | **Server** |
| **User/auth management** | **Server** |

## Communication

Client ↔ Server via HTTPS/WebSocket API
