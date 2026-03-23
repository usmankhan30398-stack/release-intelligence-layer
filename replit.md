# Release Communications Automation

## Overview
Automated release communication system that ingests completed Linear tickets and generates tailored outputs for multiple audiences. Triggered by Linear webhook events when issues are completed. The system waits until ALL tickets in a Linear Project are completed before generating release communications for the entire batch.

## Architecture
- **Trigger**: Linear webhook (`issue.updated` events) → filters for completed issues → checks if all project tickets are done via Linear API
- **Linear API Integration**: Uses LINEAR_API_KEY to query project issues and check completion status
- **Agent**: Release Communications Agent (GPT-5) — classifies tickets and generates audience-tailored content
- **Workflow Pipeline** (triggered only when entire project is complete):
  1. Ingest & normalize all project tickets as a batch
  2. Classify each ticket (change type, customer impact, visibility, product area, risk flags)
  3. Group tickets into release themes
  4. Generate structured release object (single source of truth)
  5. Parallel generation of 5 outputs:
     - Customer Release Notes
     - Internal Changelog
     - Sales Enablement Brief
     - CS/Support FAQ
     - Slack Announcement
  6. Save all outputs to timestamped Markdown file in `releases/` directory

## Key Files
- `src/triggers/exampleConnectorTrigger.ts` — Linear webhook trigger registration
- `src/mastra/tools/linearApi.ts` — Linear API tool for querying project issues and checking completion
- `src/mastra/agents/agent.ts` — Release Communications Agent
- `src/mastra/workflows/workflow.ts` — Full workflow pipeline (batch processing)
- `src/mastra/index.ts` — Mastra instance with all registrations and trigger handler logic
- `tests/testWebhookAutomation.ts` — Webhook automation test

## Design Decisions
- **Project-based batching**: Only triggers release pipeline when ALL tickets in a Linear Project are completed
- **Linear API check**: Each completed ticket triggers a check — "are all sibling tickets also done?"
- Structured JSON release object serves as canonical source to prevent cross-team content drift
- Parallel execution of all 5 outputs ensures alignment from same source data
- Agent classifies by: changeType, customerImpact, customerVisibility, productArea, riskFlags
- Handles feature flags, breaking changes, and partial releases with appropriate risk flagging
- Graceful error handling: Linear API failures are caught and logged, webhook returns skipped status

## Environment Variables
- `LINEAR_API_KEY` — Personal API key for querying Linear projects (stored as secret)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API key via Replit AI Integrations
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI base URL via Replit AI Integrations
- `RELEASES_DIR` — Optional: custom directory for release output files (defaults to `releases/`)

## Recent Changes
- 2026-02-23: Updated to project-based batch processing — waits for all project tickets to complete
- 2026-02-23: Added Linear API tool for querying project issues and completion status
- 2026-02-23: Updated trigger handler with completed-state filtering and project completion check
- 2026-02-23: Initial implementation of full release communication pipeline
