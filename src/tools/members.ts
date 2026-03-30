import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

interface Member {
  id: number;
  name: string;
  email: string;
}

export function registerMemberTools(server: McpServer) {
  server.tool(
    "list_members",
    "List team members (for assigning issues)",
    { team_id: z.number().describe("Team ID") },
    async ({ team_id }) => {
      const members = await apiRequest<Member[]>(
        `/api/v1/teams/${team_id}/members`
      );
      const text = members
        .map((m) => `• ${m.name} (${m.email}) — ID: ${m.id}`)
        .join("\n");
      return {
        content: [{ type: "text", text: text || "No members found." }],
      };
    }
  );
}
