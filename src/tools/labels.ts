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
        .map((l) => `• ${l.name} — ID: ${l.id}`)
        .join("\n");
      return { content: [{ type: "text", text: text || "No labels found." }] };
    }
  );
}
