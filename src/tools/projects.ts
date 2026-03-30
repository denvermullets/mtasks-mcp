import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

interface Project {
  id: number;
  name: string;
  description: string;
}

export function registerProjectTools(server: McpServer) {
  server.tool(
    "list_projects",
    "List available projects for a team",
    { team_id: z.number().describe("Team ID") },
    async ({ team_id }) => {
      const projects = await apiRequest<Project[]>(
        `/api/v1/teams/${team_id}/projects`
      );
      const text = projects
        .map((p) => `• ${p.name} — ID: ${p.id}${p.description ? ` (${p.description})` : ""}`)
        .join("\n");
      return {
        content: [{ type: "text", text: text || "No projects found." }],
      };
    }
  );
}
