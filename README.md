# Release Intelligence Layer

An automated release communication system that ingests completed Linear tickets and generates five audience-specific artifacts from a single structured release pipeline.

## Overview

Release communication is a recurring workflow where the same engineering information gets rewritten multiple times across Product, Sales, CS, and internal teams — creating inconsistency, missed migration instructions, and accidental exposure of internal work.

This system introduces a structured intelligence layer that classifies tickets once and generates all five outputs from a single source of truth.

**Classify once. Write five ways.**

## How It Works

A Linear Project represents a release. When all tickets in a project are marked complete, the pipeline triggers automatically.

### Pipeline Stages

1. **Batch Classification** — All tickets are analyzed in a single pass. For each ticket, the system determines:
   - Change type (feature, bug fix, infrastructure, improvement)
   - Customer impact (high, medium, low, none)
   - Customer visibility (visible vs. internal)
   - Product area
   - Risk flags (breaking change, behind feature flag, partially shipped, requires migration)

2. **Theme Grouping** — Tickets are grouped into coherent release themes based on product area and related functionality. Each ticket is assigned to exactly one theme.

3. **Structured Release Object** — A single source of truth combining themes, ticket metadata, visibility flags, and risk signals. Every output reads from this structure.

4. **Parallel Generation** — Five audience-specific artifacts generated simultaneously:
   - **Customer Release Notes** — Benefit-focused, excludes internal and feature-flagged work, inline breaking change guidance
   - **Internal Changelog** — Ticket IDs, PR links, risk flags, rollback considerations, grouped by theme
   - **Sales Enablement Brief** — Value positioning, talk tracks, and guardrails for partially shipped features
   - **CS/Support FAQ** — Anticipated questions, escalation paths, rollout timelines
   - **Slack Announcement** — Concise internal summary, under 300 words

Output is written to a timestamped Markdown file in the `releases/` directory.

## What the System Handles

- Feature-flagged work excluded from customer-facing outputs
- Breaking changes surfaced with migration guidance inline
- Partial rollouts clearly labeled with rollout scope
- Internal infrastructure not surfaced externally

## Tech Stack

- [Mastra](https://mastra.ai) — Workflow orchestration
- [Linear API](https://developers.linear.app) — Ticket ingestion and project completion detection
- OpenAI GPT-4o — Classification and generation
- Inngest — Step execution and retry handling
- PostgreSQL — Agent memory
- TypeScript / Node.js

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Linear account with API key
- OpenAI API key

### Environment Variables

```bash
LINEAR_API_KEY=                    # Linear personal API key
AI_INTEGRATIONS_OPENAI_API_KEY=    # OpenAI API key
AI_INTEGRATIONS_OPENAI_BASE_URL=   # OpenAI base URL
DATABASE_URL=                      # PostgreSQL connection string
```

### Installation

```bash
npm install
```

### Running Locally

```bash
# Start the Mastra dev server
mastra dev

# Start the Inngest dev server (separate terminal)
./scripts/inngest.sh
```

### Triggering the Pipeline

```bash
npx tsx tests/testWebhookAutomation.ts
```

This simulates a Linear webhook event. The generated release file will appear in the `releases/` directory.

## Project Structure

```
src/
├── mastra/
│   ├── agents/agent.ts               # Release Communications Agent
│   ├── tools/linearApi.ts            # Linear API integration
│   ├── workflows/workflow.ts         # Full pipeline workflow
│   └── index.ts                      # Mastra instance and trigger handler
├── triggers/
│   └── exampleConnectorTrigger.ts   # Linear webhook trigger
tests/
└── testWebhookAutomation.ts         # Pipeline test script
releases/                             # Generated release artifacts (gitignored)
```

## Iteration Roadmap

**Iteration 1 (current):** Validate the intelligence layer — classification, filtering, multi-audience generation.

**Iteration 2:** Approval gating, Slack auto-posting, persistent release history, hosted Inngest for production webhook support.

**Iteration 3:** Classification feedback loops, manual override controls, front-end review interface.
