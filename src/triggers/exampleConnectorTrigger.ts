import { registerApiRoute } from "../mastra/inngest";
import type { Mastra } from "@mastra/core";

export type LinearWebhookPayload = {
  action: string;
  type: string;
  data: {
    id: string;
    title: string;
    description?: string;
    number: number;
    priority: number;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    projectId?: string;
    teamId?: string;
    assigneeId?: string;
    stateId?: string;
    labelIds?: string[];
    cycleId?: string;
    url?: string;
    [key: string]: any;
  };
  updatedFrom?: {
    [key: string]: any;
  };
  createdAt: string;
  organizationId: string;
  webhookId: string;
  url: string;
  [key: string]: any;
};

export type TriggerInfoLinearIssueUpdate = {
  type: "linear/issue.updated";
  payload: LinearWebhookPayload;
};

type LinearTriggerHandler = (
  mastra: Mastra,
  triggerInfo: TriggerInfoLinearIssueUpdate,
  runId?: string,
) => Promise<any>;

export function registerLinearTrigger({
  triggerType,
  handler,
}: {
  triggerType: "linear/issue.updated";
  handler: LinearTriggerHandler;
}) {
  return [
    registerApiRoute("/linear/webhook", {
      method: "POST",
      handler: async (c) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();

        try {
          const payload = await c.req.json();
          logger?.info("📥 [Linear] Webhook received", {
            action: payload.action,
            type: payload.type,
          });

          if (payload.type !== "Issue") {
            logger?.info("⏭️ [Linear] Skipping non-Issue event", {
              type: payload.type,
            });
            return c.json({ success: true, skipped: true });
          }

          if (payload.action !== "update") {
            logger?.info("⏭️ [Linear] Skipping non-update action", {
              action: payload.action,
            });
            return c.json({ success: true, skipped: true });
          }

          if (!payload.data) {
            logger?.warn("⚠️ [Linear] Missing data field, using empty object");
            payload.data = {};
          }

          const triggerInfo: TriggerInfoLinearIssueUpdate = {
            type: triggerType,
            payload: payload as LinearWebhookPayload,
          };

          const runId = c.req.header("x-mastra-run-id");

          logger?.info("🚀 [Linear] Processing issue update", {
            issueId: payload.data?.id,
            title: payload.data?.title,
          });

          const result = await handler(mastra, triggerInfo, runId);

          logger?.info("✅ [Linear] Handler completed", { result });

          return c.json({ success: true, result });
        } catch (error) {
          logger?.error("❌ [Linear] Error processing webhook", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });

          return c.json(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            500,
          );
        }
      },
    }),
  ];
}
