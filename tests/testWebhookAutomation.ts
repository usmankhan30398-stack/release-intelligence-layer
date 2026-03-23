/**
 * Test Script for Webhook-Triggered Workflows
 *
 * This script demonstrates the CORRECT way to test webhook-triggered workflows
 * that use Inngest for orchestration. It simulates the complete production flow.
 *
 * WHAT THIS TESTS:
 * - Inngest event routing (event/api.webhooks.{provider}.action)
 *   Note: Slack/Telegram use event/api.webhooks.webhooks.action due to /webhooks/{provider}/action path
 * - The forwarding function created by registerApiRoute
 * - HTTP forwarding to your webhook handler (e.g., /linear/webhook)
 * - Webhook payload validation in your handler
 * - Workflow triggering via workflow.start()
 * - Complete Inngest step-by-step orchestration
 *
 * PREREQUISITES:
 * 1. Start your Mastra server with restart_workflow tool
 * 2. Start Inngest dev server with restart_workflow tool
 *
 * HOW TO RUN:
 * npx tsx tests/testWebhookAutomation.ts
 *
 * VERIFICATION:
 * - Check console output for success messages
 * - Visit http://localhost:3000 to see execution in Inngest dashboard
 */

import { inngest } from "../src/mastra/inngest/client";

// ============================================================================
// CONFIGURATION - Update these based on your webhook automation
// ============================================================================

// Change this to match your connector name
const PROVIDER: string = "linear"; // e.g., "linear", "github", etc

// Mock webhook payload - simulates the LAST ticket in a project being completed.
// The trigger handler will:
// 1. See this issue was just completed (completedAt set, updatedFrom.completedAt absent)
// 2. See it has a projectId
// 3. Query the Linear API to check if all project tickets are done
// 4. If all done, fetch all tickets and run the full release pipeline
const mockWebhookPayload = {
  action: "update",
  type: "Issue",
  data: {
    id: "1e1068a3-b0c7-4379-a164-c3cf96175608",
    title: "Revenue leakage detection model v1 (feature-flagged)",
    description: "Introduces an advanced AI model to detect patterns of unbilled time across practice groups",
    number: 11,
    priority: 0,
    createdAt: "2026-02-23T22:01:33.273Z",
    updatedAt: "2026-02-23T23:27:54.335Z",
    completedAt: "2026-02-23T23:23:12.274Z",
    projectId: "28cb702f-77b1-4cd7-9a63-0250eb8f2f0b",
    stateId: "08601155-d671-46c8-8e50-b130f6d55d9a",
    labelIds: [],
    url: "https://linear.app/7886/issue/MY-11/revenue-leakage-detection-model-v1-feature-flagged",
  },
  updatedFrom: {
    stateId: "state-in-progress-456",
  },
  createdAt: "2025-01-15T10:30:00Z",
  organizationId: "mock-org-123",
  webhookId: "mock-webhook-456",
  url: "https://linear.app/mock-org/issue/MOCK-999",
};

// ============================================================================
// TEST FUNCTION
// ============================================================================

async function testWebhookTrigger() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🚀 WEBHOOK AUTOMATION TEST`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Provider: ${PROVIDER}\n`);

  console.log(`📋 This test simulates a Linear issue being marked as completed.`);
  console.log(`   The trigger will check if the issue's project is fully complete.`);
  console.log(`   NOTE: With mock data, the Linear API call will fail because`);
  console.log(`   the mock projectId doesn't exist in your Linear workspace.\n`);
  console.log(`   To test the FULL flow, use a real projectId from your Linear account.\n`);

  try {
    /**
     * Send an Inngest event that simulates what Replit Webhook Service sends in production.
     *
     * In production, the flow is:
     * 1. External webhook → Replit Webhook Service
     * 2. Replit transforms it → Inngest Cloud (sends event/api.webhooks.{provider}.action)
     * 3. Inngest Cloud → triggers the forwarding function (id: "api-{provider}")
     * 4. Forwarding function → POSTs to your webhook handler (/{provider}/webhook)
     * 5. Webhook handler → validates payload and starts workflow
     * 6. Workflow → orchestrated by Inngest step-by-step
     *
     * This test simulates step 2, exercising the complete flow from there.
     */

    const eventName = `event/api.webhooks.${PROVIDER}.action`;

    await inngest.send({
      // Event name must match what registerApiRoute creates an Inngest function to listen for
      name: eventName,

      // Data structure matches what Replit Webhook Service sends to Inngest
      data: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mockWebhookPayload),
      },
    });

    console.log(`✅ Event sent successfully for ${PROVIDER}!`);
    console.log(`\n📊 Check execution at: http://localhost:3000`);
    console.log(
      `   - Functions tab: Look for "api-${PROVIDER}" (the forwarding function)`,
    );
    console.log(`   - Runs tab: See the complete execution trace\n`);
  } catch (error) {
    console.error("❌ Error sending Inngest event:", error);
    console.error("\nTroubleshooting:");
    console.error("  1. Is your Mastra server running? (npm start)");
    console.error(
      "  2. Is Inngest dev server running? (inngest dev -u http://localhost:5000/api/inngest --port 3000)",
    );
    console.error(
      "  3. Is the webhook handler registered in src/mastra/index.ts?\n",
    );
    process.exit(1);
  }
}

// Run the test
testWebhookTrigger();
