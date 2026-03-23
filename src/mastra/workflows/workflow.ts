import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { automationAgent } from "../agents/agent";
import * as fs from "fs";
import * as path from "path";

const classificationSchema = z.object({
  changeType: z.enum(["feature", "bugfix", "infrastructure", "improvement"]),
  customerImpact: z.enum(["high", "medium", "low", "none"]),
  customerVisibility: z.enum(["visible", "internal"]),
  productArea: z.string().min(1),
  riskFlags: z.array(z.string()),
});

const themeGroupSchema = z.object({
  themes: z.array(z.object({
    themeName: z.string().min(1),
    themeDescription: z.string().min(1),
    ticketIds: z.array(z.string()),
  })),
});

function extractAndParseJson<T>(text: string, schema: z.ZodSchema<T>, logger: any): { data: T | null; error: string | null } {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger?.warn("⚠️ No JSON object found in response");
    return { data: null, error: "No JSON found" };
  }
  try {
    const raw = JSON.parse(jsonMatch[0]);
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      return { data: parsed.data, error: null };
    }
    logger?.warn("⚠️ JSON validation failed", { issues: parsed.error.issues });
    return { data: null, error: parsed.error.message };
  } catch (e) {
    logger?.warn("⚠️ JSON parse error", { error: String(e) });
    return { data: null, error: String(e) };
  }
}

const normalizedTicketSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  number: z.number(),
  priority: z.number(),
  completedAt: z.string().optional(),
  updatedAt: z.string(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  labels: z.array(z.string()).optional(),
  url: z.string().optional(),
});

const classifiedTicketSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  number: z.number(),
  priority: z.number(),
  completedAt: z.string().optional(),
  updatedAt: z.string(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  labels: z.array(z.string()).optional(),
  url: z.string().optional(),
  changeType: z.string(),
  customerImpact: z.string(),
  customerVisibility: z.string(),
  productArea: z.string(),
  riskFlags: z.array(z.string()),
});

const releaseThemeSchema = z.object({
  themeName: z.string(),
  themeDescription: z.string(),
  tickets: z.array(classifiedTicketSchema),
});

const structuredReleaseSchema = z.object({
  releaseDate: z.string(),
  projectName: z.string(),
  totalTickets: z.number(),
  themes: z.array(releaseThemeSchema),
  summary: z.string(),
  hasBreakingChanges: z.boolean(),
  hasFeatureFlags: z.boolean(),
});

const ingestProjectTickets = createStep({
  id: "ingest-project-tickets",
  description: "Ingests all completed tickets from a Linear project and normalizes them",

  inputSchema: z.object({
    projectName: z.string(),
    projectId: z.string(),
    tickets: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      number: z.number(),
      priority: z.number(),
      completedAt: z.string().optional(),
      updatedAt: z.string(),
      projectId: z.string().optional(),
      labels: z.array(z.string()).optional(),
      url: z.string().optional(),
    })),
  }) as any,

  outputSchema: z.object({
    projectName: z.string(),
    tickets: z.array(normalizedTicketSchema),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📥 [Ingest] Starting batch ticket normalization", {
      projectName: inputData.projectName,
      ticketCount: inputData.tickets.length,
    });

    const normalizedTickets = inputData.tickets.map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description || "",
      number: t.number,
      priority: t.priority,
      completedAt: t.completedAt,
      updatedAt: t.updatedAt,
      projectId: t.projectId || inputData.projectId,
      projectName: inputData.projectName,
      labels: t.labels || [],
      url: t.url || "",
    }));

    logger?.info("✅ [Ingest] All tickets normalized successfully", {
      count: normalizedTickets.length,
      titles: normalizedTickets.map((t: any) => t.title),
    });

    return {
      projectName: inputData.projectName,
      tickets: normalizedTickets,
    };
  },
});

const batchClassificationSchema = z.object({
  classifications: z.array(z.object({
    id: z.string(),
    changeType: z.enum(["feature", "bugfix", "infrastructure", "improvement"]),
    customerImpact: z.enum(["high", "medium", "low", "none"]),
    customerVisibility: z.enum(["visible", "internal"]),
    productArea: z.string().min(1),
    riskFlags: z.array(z.string()),
  })),
});

const classifyAllTickets = createStep({
  id: "classify-all-ticket-attributes",
  description: "Classifies all tickets in a single batch by change type, customer impact, visibility, product area, and risk flags",

  inputSchema: z.object({
    projectName: z.string(),
    tickets: z.array(normalizedTicketSchema),
  }) as any,

  outputSchema: z.array(classifiedTicketSchema),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const tickets = inputData.tickets;

    logger?.info("🏷️ [Classify] Batch classifying all tickets", {
      ticketCount: tickets.length,
    });

    const ticketList = tickets.map((t: any) =>
      `Ticket ID: "${t.id}"
- Title: ${t.title}
- Description: ${t.description || "No description"}
- Priority: ${t.priority} (0=none, 1=urgent, 2=high, 3=medium, 4=low)
- Labels: ${(t.labels || []).join(", ") || "None"}`
    ).join("\n\n");

    const prompt = `Analyze ALL of these Linear tickets and classify each one. Return ONLY a valid JSON object with a "classifications" array.

Tickets:
${ticketList}

Return JSON in this exact format:
{
  "classifications": [
    {
      "id": "<ticket id>",
      "changeType": "feature" | "bugfix" | "infrastructure" | "improvement",
      "customerImpact": "high" | "medium" | "low" | "none",
      "customerVisibility": "visible" | "internal",
      "productArea": "<inferred area like Authentication, Billing, Dashboard, API, Performance, etc.>",
      "riskFlags": ["breaking_change" | "behind_feature_flag" | "partially_shipped" | "requires_migration" | "none"]
    }
  ]
}

Rules:
- Return one classification object per ticket, using the exact ticket ID
- Every ticket must be classified`;

    let batchResult: z.infer<typeof batchClassificationSchema> | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const messages: any[] = [{ role: "user", content: prompt }];
      if (attempt > 0) {
        messages.push({ role: "user", content: "Your previous response was not valid JSON. Return ONLY a raw JSON object with a 'classifications' array, no markdown fences, no prose." });
      }

      const response = await automationAgent.generate(messages);
      const result = extractAndParseJson(response.text, batchClassificationSchema, logger);

      if (result.data) {
        batchResult = result.data;
        break;
      }

      logger?.warn(`⚠️ [Classify] Batch attempt ${attempt + 1} failed to parse`, { error: result.error });
    }

    const classificationMap = new Map<string, z.infer<typeof classificationSchema>>();
    if (batchResult) {
      for (const c of batchResult.classifications) {
        classificationMap.set(c.id, c);
      }
    }

    const classifiedTickets = tickets.map((t: any) => {
      const classification = classificationMap.get(t.id);
      if (classification) {
        logger?.info("✅ [Classify] Ticket classified", {
          ticketId: t.id,
          changeType: classification.changeType,
          customerImpact: classification.customerImpact,
        });
        return {
          ...t,
          labels: t.labels || [],
          changeType: classification.changeType,
          customerImpact: classification.customerImpact,
          customerVisibility: classification.customerVisibility,
          productArea: classification.productArea,
          riskFlags: Array.isArray(classification.riskFlags) ? classification.riskFlags : ["none"],
        };
      }

      logger?.warn("⚠️ [Classify] No classification found for ticket, using defaults", { ticketId: t.id, title: t.title });
      return {
        ...t,
        labels: t.labels || [],
        changeType: "improvement",
        customerImpact: "low",
        customerVisibility: "internal",
        productArea: "General",
        riskFlags: ["none"],
      };
    });

    logger?.info("✅ [Classify] All tickets classified", {
      total: classifiedTickets.length,
      classified: classificationMap.size,
    });

    return classifiedTickets;
  },
});

const groupTicketsIntoThemes = createStep({
  id: "group-tickets-into-release-themes",
  description: "Groups classified tickets into coherent release themes to reduce noise and make outputs coherent",

  inputSchema: z.array(classifiedTicketSchema) as any,

  outputSchema: z.object({
    projectName: z.string(),
    themes: z.array(releaseThemeSchema),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const tickets = Array.isArray(inputData) ? inputData : [inputData];

    const projectName = tickets[0]?.projectName || "Release";

    logger?.info("📦 [Group] Grouping tickets into themes", {
      ticketCount: tickets.length,
      projectName,
    });

    const ticketSummaries = tickets.map((t: any) =>
      `- ID: "${t.id}" | [${t.changeType}] ${t.title} (Impact: ${t.customerImpact}, Area: ${t.productArea}, Visibility: ${t.customerVisibility})`
    ).join("\n");

    const prompt = `Given these classified tickets, group them into coherent release themes. Each ticket must be assigned to EXACTLY ONE theme — no duplicates across themes. Return ONLY a valid JSON object.

Tickets:
${ticketSummaries}

Return JSON in this format:
{
  "themes": [
    {
      "themeName": "<theme name>",
      "themeDescription": "<1-2 sentence description of this theme>",
      "ticketIds": ["<ticket id 1>", "<ticket id 2>"]
    }
  ]
}

Rules:
- Group related tickets by product area or feature
- Every ticket ID must appear in exactly one theme — no ticket should be in multiple themes
- If there's only one ticket, create a single theme for it
- Theme names should be user-friendly (e.g., "Authentication Improvements", "Performance Upgrades", "Bug Fixes")`;

    let themeData: z.infer<typeof themeGroupSchema> | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const messages: any[] = [{ role: "user", content: prompt }];
      if (attempt > 0) {
        messages.push({ role: "user", content: "Your previous response was not valid JSON. Return ONLY a raw JSON object with a 'themes' array, no markdown fences, no prose." });
      }

      const response = await automationAgent.generate(messages);
      const result = extractAndParseJson(response.text, themeGroupSchema, logger);

      if (result.data) {
        themeData = result.data;
        break;
      }

      logger?.warn(`⚠️ [Group] Attempt ${attempt + 1} failed to parse`, { error: result.error });
    }

    if (!themeData) {
      logger?.warn("⚠️ [Group] All attempts failed, using default grouping");
      themeData = {
        themes: [{ themeName: "Release Updates", themeDescription: "Updates included in this release", ticketIds: tickets.map((t: any) => t.id) }],
      };
    }

    const ticketMap = new Map(tickets.map((t: any) => [t.id, t]));
    const assignedIds = new Set<string>();

    const themes = themeData.themes.map((theme: any) => {
      const themeTickets = (theme.ticketIds || [])
        .filter((id: string) => ticketMap.has(id) && !assignedIds.has(id))
        .map((id: string) => {
          assignedIds.add(id);
          return ticketMap.get(id);
        });

      return {
        themeName: theme.themeName,
        themeDescription: theme.themeDescription,
        tickets: themeTickets,
      };
    }).filter((theme: any) => theme.tickets.length > 0);

    const unassigned = tickets.filter((t: any) => !assignedIds.has(t.id));
    if (unassigned.length > 0) {
      logger?.warn("⚠️ [Group] Some tickets were not assigned to any theme, adding to last theme", {
        unassignedCount: unassigned.length,
        unassignedTitles: unassigned.map((t: any) => t.title),
      });
      if (themes.length > 0) {
        themes[themes.length - 1].tickets.push(...unassigned);
      } else {
        themes.push({
          themeName: "Other Updates",
          themeDescription: "Additional updates included in this release",
          tickets: unassigned,
        });
      }
    }

    logger?.info("✅ [Group] Tickets grouped into themes", {
      themeCount: themes.length,
      themeNames: themes.map((t: any) => t.themeName),
    });

    return { projectName, themes };
  },
});

const generateStructuredRelease = createStep({
  id: "generate-structured-release-object",
  description: "Generates a canonical JSON release object from grouped tickets that serves as single source of truth",

  inputSchema: z.object({
    projectName: z.string(),
    themes: z.array(releaseThemeSchema),
  }) as any,

  outputSchema: structuredReleaseSchema,

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📋 [Release Object] Building structured release object", {
      projectName: inputData.projectName,
      themeCount: inputData.themes.length,
    });

    const allTickets = inputData.themes.flatMap((t: any) => t.tickets);
    const hasBreakingChanges = allTickets.some((t: any) =>
      t.riskFlags?.includes("breaking_change")
    );
    const hasFeatureFlags = allTickets.some((t: any) =>
      t.riskFlags?.includes("behind_feature_flag")
    );

    const themeSummaries = inputData.themes
      .map((t: any) => `${t.themeName}: ${t.themeDescription}`)
      .join("; ");

    const releaseObject = {
      releaseDate: new Date().toISOString().split("T")[0],
      projectName: inputData.projectName,
      totalTickets: allTickets.length,
      themes: inputData.themes,
      summary: `Release "${inputData.projectName}" includes ${allTickets.length} ticket(s) across ${inputData.themes.length} theme(s): ${themeSummaries}`,
      hasBreakingChanges,
      hasFeatureFlags,
    };

    logger?.info("✅ [Release Object] Structured release object created", {
      projectName: releaseObject.projectName,
      totalTickets: releaseObject.totalTickets,
      themeCount: releaseObject.themes.length,
      hasBreakingChanges,
      hasFeatureFlags,
    });

    return releaseObject;
  },
});

const generateCustomerReleaseNotes = createStep({
  id: "generate-customer-release-notes",
  description: "Generates customer-facing release notes from the structured release object",

  inputSchema: structuredReleaseSchema as any,

  outputSchema: z.object({
    content: z.string(),
    format: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📝 [Customer Notes] Generating customer release notes");

    const prompt = `Generate customer-facing release notes based on this release data. Write in a clear, benefit-focused tone. No technical jargon. Focus on what changed and why it matters to users.

Release Data:
${JSON.stringify(inputData, null, 2)}

Format the output as clean Markdown with:
- A brief intro paragraph
- Grouped sections by theme
- Bullet points for each change with user-friendly descriptions
- Include ALL tickets with customerVisibility "visible", regardless of impact level (even "low" impact bug fixes matter to customers)
- Skip any tickets with customerVisibility "internal"
- If there are breaking changes, mention them within the relevant theme section — do NOT add a separate "Breaking changes" section at the end (avoid redundancy)

Return ONLY the Markdown content, no JSON wrapper.`;

    const response = await automationAgent.generate(
      [{ role: "user", content: prompt }],
    );

    logger?.info("✅ [Customer Notes] Customer release notes generated", {
      contentLength: response.text.length,
    });

    return {
      content: response.text,
      format: "markdown",
    };
  },
});

const generateInternalChangelog = createStep({
  id: "generate-internal-changelog",
  description: "Generates internal changelog for engineering and product teams",

  inputSchema: structuredReleaseSchema as any,

  outputSchema: z.object({
    content: z.string(),
    format: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📋 [Internal Changelog] Generating internal changelog");

    const prompt = `Generate an internal changelog for engineering and product teams based on this release data. Include technical details, ticket references, and implementation notes.

Release Data:
${JSON.stringify(inputData, null, 2)}

Format as Markdown with:
- Release date and summary stats
- Sections grouped by theme
- Each ticket with: title, ticket number, change type, risk flags
- Technical notes where relevant
- A "Risk & Rollback" section if there are breaking changes or feature flags

Return ONLY the Markdown content.`;

    const response = await automationAgent.generate(
      [{ role: "user", content: prompt }],
    );

    logger?.info("✅ [Internal Changelog] Internal changelog generated", {
      contentLength: response.text.length,
    });

    return {
      content: response.text,
      format: "markdown",
    };
  },
});

const generateSalesBrief = createStep({
  id: "generate-sales-enablement-brief",
  description: "Generates sales enablement brief emphasizing customer-facing impact and competitive advantages",

  inputSchema: structuredReleaseSchema as any,

  outputSchema: z.object({
    content: z.string(),
    format: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("💼 [Sales Brief] Generating sales enablement brief");

    const prompt = `Generate a sales enablement brief based on this release data. Focus on customer-facing impact, competitive advantages, and talking points for sales conversations.

Release Data:
${JSON.stringify(inputData, null, 2)}

Format as Markdown with:
- "What Shipped" executive summary (2-3 sentences)
- "Key Talking Points" — bullet points sales can use in conversations
- "Customer Impact" — who benefits and how
- "Competitive Angle" — how these changes position us
- "What NOT to Promise" — features behind flags or partially shipped
- Skip internal/infrastructure changes unless they enable a customer-facing benefit

Return ONLY the Markdown content.`;

    const response = await automationAgent.generate(
      [{ role: "user", content: prompt }],
    );

    logger?.info("✅ [Sales Brief] Sales enablement brief generated", {
      contentLength: response.text.length,
    });

    return {
      content: response.text,
      format: "markdown",
    };
  },
});

const generateCsSupportFaq = createStep({
  id: "generate-cs-support-faq",
  description: "Generates CS/Support FAQ anticipating customer questions and providing clear answers",

  inputSchema: structuredReleaseSchema as any,

  outputSchema: z.object({
    content: z.string(),
    format: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🎧 [CS/Support FAQ] Generating CS/Support FAQ");

    const prompt = `Generate a Customer Success and Support FAQ based on this release data. Anticipate the questions customers will ask and provide clear, concise answers.

Release Data:
${JSON.stringify(inputData, null, 2)}

Format as Markdown with:
- "Summary for CS Team" — 2-3 sentence overview
- "Who Is Affected" — which customers see these changes
- "FAQ" section with Q&A pairs:
  - Common questions customers might ask
  - Clear, copy-pasteable answers for support agents
- "Known Issues / Caveats" — anything CS should be aware of
- "Escalation Notes" — when to escalate and to whom (use placeholders)

Return ONLY the Markdown content.`;

    const response = await automationAgent.generate(
      [{ role: "user", content: prompt }],
    );

    logger?.info("✅ [CS/Support FAQ] CS/Support FAQ generated", {
      contentLength: response.text.length,
    });

    return {
      content: response.text,
      format: "markdown",
    };
  },
});

const generateSlackAnnouncement = createStep({
  id: "generate-slack-announcement",
  description: "Generates a concise Slack announcement for internal team communication",

  inputSchema: structuredReleaseSchema as any,

  outputSchema: z.object({
    content: z.string(),
    format: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("💬 [Slack] Generating Slack announcement");

    const prompt = `Generate a Slack announcement for this release. Make it concise, scannable, and use emoji for quick consumption.

Release Data:
${JSON.stringify(inputData, null, 2)}

Format for Slack (use Slack markdown):
- Start with a header line using emoji (e.g., "🚀 Release Update — [date]")
- Brief 1-2 sentence summary
- Bullet points with emoji for key changes grouped by theme
- A "⚠️ Heads Up" section if there are breaking changes or feature flags
- End with a brief note pointing to full release notes
- Keep it under 300 words — this is meant to be skimmed

Return ONLY the Slack message content.`;

    const response = await automationAgent.generate(
      [{ role: "user", content: prompt }],
    );

    logger?.info("✅ [Slack] Slack announcement generated", {
      contentLength: response.text.length,
    });

    return {
      content: response.text,
      format: "slack",
    };
  },
});

const parallelOutputSchema = z.object({
  "generate-customer-release-notes": z.object({
    content: z.string(),
    format: z.string(),
  }),
  "generate-internal-changelog": z.object({
    content: z.string(),
    format: z.string(),
  }),
  "generate-sales-enablement-brief": z.object({
    content: z.string(),
    format: z.string(),
  }),
  "generate-cs-support-faq": z.object({
    content: z.string(),
    format: z.string(),
  }),
  "generate-slack-announcement": z.object({
    content: z.string(),
    format: z.string(),
  }),
});

const saveOutputsToFile = createStep({
  id: "save-outputs-to-file",
  description: "Saves all generated release communications to a timestamped Markdown file",

  inputSchema: parallelOutputSchema.extend({
    projectName: z.string().optional(),
  }) as any,

  outputSchema: z.object({
    filePath: z.string(),
    savedAt: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

    const projectName = inputData.projectName || "Release";

    const receivedKeys = Object.keys(inputData || {});
    logger?.info("💾 [Save] Starting file save step", {
      receivedKeys,
      projectName,
      timestamp: now.toISOString(),
    });

    const baseDir = process.env.RELEASES_DIR || path.resolve("/home/runner/workspace", "releases");
    const releasesDir = path.resolve(baseDir);

    try {
      if (!fs.existsSync(releasesDir)) {
        fs.mkdirSync(releasesDir, { recursive: true });
        logger?.info("📁 [Save] Created releases directory", { path: releasesDir });
      }
    } catch (dirError) {
      logger?.error("❌ [Save] Failed to create releases directory", {
        path: releasesDir,
        error: String(dirError),
      });
      throw new Error(`Failed to create releases directory at ${releasesDir}: ${dirError}`);
    }

    const safeProjectName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const fileName = `${dateStr}_${safeProjectName}_${timeStr}.md`;
    const filePath = path.join(releasesDir, fileName);

    const customerNotes = inputData["generate-customer-release-notes"]?.content || "N/A";
    const internalChangelog = inputData["generate-internal-changelog"]?.content || "N/A";
    const salesBrief = inputData["generate-sales-enablement-brief"]?.content || "N/A";
    const csFaq = inputData["generate-cs-support-faq"]?.content || "N/A";
    const slackAnnouncement = inputData["generate-slack-announcement"]?.content || "N/A";

    const fileContent = `# Release Communications — ${projectName} — ${dateStr}
Generated at: ${now.toISOString()}

---

## Customer Release Notes

${customerNotes}

---

## Internal Changelog

${internalChangelog}

---

## Sales Enablement Brief

${salesBrief}

---

## CS/Support FAQ

${csFaq}

---

## Slack Announcement

${slackAnnouncement}
`;

    try {
      fs.writeFileSync(filePath, fileContent, "utf-8");
    } catch (writeError) {
      logger?.error("❌ [Save] Failed to write release file", {
        filePath,
        error: String(writeError),
      });
      throw new Error(`Failed to write release file at ${filePath}: ${writeError}`);
    }

    logger?.info("✅ [Save] All outputs saved to file", {
      filePath,
      fileSize: fileContent.length,
    });

    return {
      filePath,
      savedAt: now.toISOString(),
    };
  },
});

export const automationWorkflow = createWorkflow({
  id: "automation-workflow",

  inputSchema: z.object({
    projectName: z.string(),
    projectId: z.string(),
    tickets: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      number: z.number(),
      priority: z.number(),
      completedAt: z.string().optional(),
      updatedAt: z.string(),
      projectId: z.string().optional(),
      labels: z.array(z.string()).optional(),
      url: z.string().optional(),
    })),
  }) as any,

  outputSchema: z.object({
    filePath: z.string(),
    savedAt: z.string(),
  }),
})
  .then(ingestProjectTickets as any)
  .then(classifyAllTickets as any)
  .then(groupTicketsIntoThemes as any)
  .then(generateStructuredRelease as any)
  .parallel([
    generateCustomerReleaseNotes as any,
    generateInternalChangelog as any,
    generateSalesBrief as any,
    generateCsSupportFaq as any,
    generateSlackAnnouncement as any,
  ])
  .map(async ({ inputData, getInitData }: any) => {
    const initData = getInitData?.();
    return { ...inputData, projectName: initData?.projectName || "Release" };
  })
  .then(saveOutputsToFile as any)
  .commit();
