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

  server.tool(
    "update_label",
    "Rename a label or change its color.",
    {
      team_id: z.number().describe("Team ID"),
      label_id: z.number().describe("Label ID"),
      name: z.string().optional().describe("New name (must be unique within team)"),
      color: z.string().optional().describe("New hex color code (e.g. #ef4444)"),
    },
    async ({ team_id, label_id, name, color }) => {
      const fields: Record<string, string> = {};
      if (name !== undefined) fields.name = name;
      if (color !== undefined) fields.color = color;
      if (Object.keys(fields).length === 0) {
        return {
          content: [
            { type: "text" as const, text: "Error: Give a name or a color to change." },
          ],
        };
      }
      const label = await apiRequest<Label>(
        `/api/v1/teams/${team_id}/labels/${label_id}`,
        { method: "PATCH", body: { label: fields } }
      );
      return {
        content: [
          {
            type: "text",
            text: `Label updated: ${label.name} (${label.color}) — ID: ${label.id}`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_label",
    "Delete a label from a team. It is removed from every issue that carries it.",
    {
      team_id: z.number().describe("Team ID"),
      label_id: z.number().describe("Label ID"),
    },
    async ({ team_id, label_id }) => {
      await apiRequest(`/api/v1/teams/${team_id}/labels/${label_id}`, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: `Label ${label_id} deleted.` }],
      };
    }
  );
}
