import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

interface Lane {
  id: number;
  name: string;
  position: number;
  color: string;
}

export function registerLaneTools(server: McpServer) {
  server.tool(
    "list_lanes",
    "List available status lanes for a team",
    { team_id: z.number().describe("Team ID") },
    async ({ team_id }) => {
      const lanes = await apiRequest<Lane[]>(
        `/api/v1/teams/${team_id}/lanes`
      );
      const text = lanes
        .map((l) => `• ${l.name} — ID: ${l.id} (position: ${l.position})`)
        .join("\n");
      return { content: [{ type: "text", text: text || "No lanes found." }] };
    }
  );
}
