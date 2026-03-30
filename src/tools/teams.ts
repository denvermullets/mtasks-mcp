import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

interface Team {
  id: number;
  name: string;
  identifier: string;
}

export function registerTeamTools(server: McpServer) {
  server.tool("list_teams", "List all teams the user has access to", {}, async () => {
    const teams = await apiRequest<Team[]>("/api/v1/teams");
    const text = teams
      .map((t) => `• ${t.name} (${t.identifier}) — ID: ${t.id}`)
      .join("\n");
    return { content: [{ type: "text", text: text || "No teams found." }] };
  });
}
