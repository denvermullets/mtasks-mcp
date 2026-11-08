import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

// Api::V1::DecisionSerializer. Decisions are pinned statements shown on an
// issue or project; the API has create and unpin, but no list endpoint.
interface Decision {
  id: number;
  body_snapshot: string;
  pinned_at: string;
  pinned_by_user: { id: number; name: string } | null;
  unpinned_at: string | null;
  issue_id: number | null;
  project_id: number | null;
}

const ownerSchema = {
  team_id: z.number().describe("Team ID"),
  issue_id: z
    .number()
    .optional()
    .describe("Issue ID (give exactly one of issue_id or project_id)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (give exactly one of issue_id or project_id)"),
};

function decisionsPath(args: {
  team_id: number;
  issue_id?: number;
  project_id?: number;
}): string {
  const { team_id, issue_id, project_id } = args;
  if ((issue_id === undefined) === (project_id === undefined)) {
    throw new Error("Give exactly one of issue_id or project_id.");
  }
  return issue_id !== undefined
    ? `/api/v1/teams/${team_id}/issues/${issue_id}/decisions`
    : `/api/v1/teams/${team_id}/projects/${project_id}/decisions`;
}

export function registerDecisionTools(server: McpServer) {
  server.tool(
    "create_decision",
    "Pin a decision (a short statement of what was decided) to an issue or a project. Keep the returned decision ID: there is no way to list decisions later, and unpin_decision needs it.",
    {
      ...ownerSchema,
      body: z.string().describe("The decision text (markdown allowed)"),
      pinned_by_email: z
        .string()
        .optional()
        .describe("Email of the team member to credit as pinning it"),
    },
    async ({ body, pinned_by_email, ...owner }) => {
      const decision = await apiRequest<Decision>(decisionsPath(owner), {
        method: "POST",
        body: {
          // The API requires a unique source-message id (decisions normally
          // come from pinned Hourglass chat messages); mint one per call.
          hourglass_message_id: `mcp-${randomUUID()}`,
          body_snapshot: body,
          pinned_by_email,
        },
      });
      const by = decision.pinned_by_user ? ` by ${decision.pinned_by_user.name}` : "";
      return {
        content: [
          {
            type: "text",
            text: `Decision pinned${by} — ID: ${decision.id}\n  ${decision.body_snapshot}`,
          },
        ],
      };
    }
  );

  server.tool(
    "unpin_decision",
    "Unpin a decision from an issue or a project. It is kept as unpinned, not deleted.",
    {
      ...ownerSchema,
      decision_id: z.number().describe("Decision ID (from create_decision)"),
    },
    async ({ decision_id, ...owner }) => {
      await apiRequest(`${decisionsPath(owner)}/${decision_id}`, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: `Decision ${decision_id} unpinned.` }],
      };
    }
  );
}
