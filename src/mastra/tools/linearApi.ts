import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const LINEAR_API_URL = "https://api.linear.app/graphql";

async function linearGraphQL(query: string, variables: Record<string, any> = {}) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY environment variable is not set");
  }

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.errors) {
    throw new Error(`Linear GraphQL error: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

export const fetchProjectIssues = createTool({
  id: "fetch-linear-project-issues",
  description: "Fetches all issues in a Linear project and returns them with their completion status. Use this to check if an entire project is complete and to get all ticket data for release communications.",

  inputSchema: z.object({
    projectId: z.string().describe("The Linear project ID to fetch issues for"),
  }),

  outputSchema: z.object({
    projectName: z.string(),
    totalIssues: z.number(),
    completedIssues: z.number(),
    allComplete: z.boolean(),
    issues: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      number: z.number(),
      priority: z.number(),
      completedAt: z.string().optional(),
      updatedAt: z.string(),
      projectId: z.string(),
      labels: z.array(z.string()),
      url: z.string(),
      stateType: z.string(),
      stateName: z.string(),
    })),
  }),

  execute: async (inputData, ctx) => {
    const logger = ctx?.mastra?.getLogger();
    logger?.info("🔍 [Linear API] Fetching project issues", { projectId: inputData.projectId });

    const query = `
      query ProjectIssues($projectIdStr: String!, $projectIdFilter: ID) {
        project(id: $projectIdStr) {
          id
          name
        }
        issues(
          filter: {
            project: { id: { eq: $projectIdFilter } }
          }
          first: 250
        ) {
          nodes {
            id
            title
            description
            number
            priority
            completedAt
            updatedAt
            url
            labels {
              nodes {
                name
              }
            }
            state {
              name
              type
            }
            project {
              id
            }
          }
        }
      }
    `;

    const data = await linearGraphQL(query, { projectIdStr: inputData.projectId, projectIdFilter: inputData.projectId });

    const project = data.project;
    const issues = data.issues.nodes;

    const mappedIssues = issues.map((issue: any) => ({
      id: issue.id,
      title: issue.title,
      description: issue.description || "",
      number: issue.number,
      priority: issue.priority,
      completedAt: issue.completedAt || undefined,
      updatedAt: issue.updatedAt,
      projectId: issue.project?.id || inputData.projectId,
      labels: (issue.labels?.nodes || []).map((l: any) => l.name),
      url: issue.url || "",
      stateType: issue.state?.type || "unknown",
      stateName: issue.state?.name || "Unknown",
    }));

    const completedIssues = mappedIssues.filter(
      (i: any) => i.stateType === "completed" || i.stateType === "canceled"
    );

    const allComplete = completedIssues.length === mappedIssues.length && mappedIssues.length > 0;

    logger?.info("✅ [Linear API] Project issues fetched", {
      projectName: project?.name,
      totalIssues: mappedIssues.length,
      completedIssues: completedIssues.length,
      allComplete,
    });

    return {
      projectName: project?.name || "Unknown Project",
      totalIssues: mappedIssues.length,
      completedIssues: completedIssues.length,
      allComplete,
      issues: mappedIssues,
    };
  },
});

export async function checkProjectCompletion(projectId: string, logger?: any): Promise<{
  allComplete: boolean;
  projectName: string;
  totalIssues: number;
  completedIssues: number;
  issues: any[];
}> {
  logger?.info("🔍 [Linear API] Checking project completion", { projectId });

  const query = `
    query ProjectIssues($projectIdStr: String!, $projectIdFilter: ID) {
      project(id: $projectIdStr) {
        id
        name
      }
      issues(
        filter: {
          project: { id: { eq: $projectIdFilter } }
        }
        first: 250
      ) {
        nodes {
          id
          title
          description
          number
          priority
          completedAt
          updatedAt
          url
          labels {
            nodes {
              name
            }
          }
          state {
            name
            type
          }
          project {
            id
          }
        }
      }
    }
  `;

  const data = await linearGraphQL(query, { projectIdStr: projectId, projectIdFilter: projectId });

  const project = data.project;
  const issues = data.issues.nodes;

  const mappedIssues = issues.map((issue: any) => ({
    id: issue.id,
    title: issue.title,
    description: issue.description || "",
    number: issue.number,
    priority: issue.priority,
    completedAt: issue.completedAt || undefined,
    updatedAt: issue.updatedAt,
    projectId: issue.project?.id || projectId,
    labels: (issue.labels?.nodes || []).map((l: any) => l.name),
    url: issue.url || "",
    stateType: issue.state?.type || "unknown",
    stateName: issue.state?.name || "Unknown",
  }));

  const completedIssues = mappedIssues.filter(
    (i: any) => i.stateType === "completed" || i.stateType === "canceled"
  );

  const allComplete = completedIssues.length === mappedIssues.length && mappedIssues.length > 0;

  logger?.info("📊 [Linear API] Project completion check result", {
    projectName: project?.name,
    totalIssues: mappedIssues.length,
    completedCount: completedIssues.length,
    allComplete,
  });

  return {
    allComplete,
    projectName: project?.name || "Unknown Project",
    totalIssues: mappedIssues.length,
    completedIssues: completedIssues.length,
    issues: mappedIssues,
  };
}
