import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

interface Label {
  id: number;
  name: string;
  color: string;
}

export function registerLabelTools(server: McpServer) {
  server.tool(
    "list_labels",
    "List available labels for a team",
    { team_id: z.number().describe("Team ID") },
    async ({ team_id }) => {
      const labels = await apiRequest<Label[]>(
        `/api/v1/teams/${team_id}/labels`
      );
      const text = labels
        .map((l) => `• ${l.name} (${l.color}) — ID: ${l.id}`)
        .join("\n");
      return { content: [{ type: "text", text: text || "No labels found." }] };
    }
  );

  server.tool(
    "create_label",
    "Create a new label for a team. Color is auto-assigned if omitted.",
    {
      team_id: z.number().describe("Team ID"),
      name: z.string().describe("Label name (must be unique within team)"),
      color: z
        .string()
        .optional()
        .describe("Hex color code (e.g. #ef4444). Auto-assigned if omitted."),
    },
    async ({ team_id, name, color }) => {
      const label = await apiRequest<Label>(
        `/api/v1/teams/${team_id}/labels`,
        {
          method: "POST",
          body: { label: { name, color } },
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Label created: ${label.name} (${label.color}) — ID: ${label.id}`,
          },
        ],
      };
    }
  );
}
