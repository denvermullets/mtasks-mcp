import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

interface IssueSummary {
  id: number;
  identifier: string;
  title: string;
}

interface IssueDependency {
  id: number;
  direction?: "blocking" | "blocked_by";
  blocking_issue: IssueSummary;
  blocked_issue: IssueSummary;
  created_at: string;
}

export function registerIssueDependencyTools(server: McpServer) {
  server.tool(
    "list_issue_dependencies",
    "List every dependency (blocking relationship) attached to an issue, including each dependency record's ID. Use this to find the dependency_id required by remove_issue_dependency.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("The issue ID whose dependencies to list"),
    },
    async ({ team_id, issue_id }) => {
      const deps = await apiRequest<IssueDependency[]>(
        `/api/v1/teams/${team_id}/issues/${issue_id}/issue_dependencies`
      );
      if (deps.length === 0) {
        return {
          content: [
            { type: "text", text: "No dependencies found for this issue." },
          ],
        };
      }
      const text = deps
        .map((dep) => {
          const relation =
            dep.direction === "blocked_by"
              ? `blocked by ${dep.blocking_issue.identifier} (${dep.blocking_issue.title})`
              : `blocking ${dep.blocked_issue.identifier} (${dep.blocked_issue.title})`;
          return `[dep #${dep.id}] This issue is ${relation}`;
        })
        .join("\n");
      return {
        content: [{ type: "text", text }],
      };
    }
  );

  server.tool(
    "create_issue_dependency",
    "Create a blocking relationship between two issues. Use direction 'blocking' to mark the issue as blocking the target, or 'blocked_by' to mark it as blocked by the target.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("The source issue ID"),
      target_issue_id: z
        .number()
        .describe("The target issue ID to create the relationship with"),
      direction: z
        .enum(["blocking", "blocked_by"])
        .describe(
          "'blocking' = this issue blocks the target; 'blocked_by' = this issue is blocked by the target"
        ),
    },
    async ({ team_id, issue_id, target_issue_id, direction }) => {
      const dep = await apiRequest<IssueDependency>(
        `/api/v1/teams/${team_id}/issues/${issue_id}/issue_dependencies`,
        {
          method: "POST",
          body: { target_issue_id, direction },
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Dependency created:\n  ${dep.blocking_issue.identifier} (${dep.blocking_issue.title}) blocks ${dep.blocked_issue.identifier} (${dep.blocked_issue.title})\n  Dependency ID: ${dep.id}`,
          },
        ],
      };
    }
  );

  server.tool(
    "remove_issue_dependency",
    "Remove a blocking relationship between issues",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("The source issue ID"),
      dependency_id: z.number().describe("The dependency ID to remove"),
    },
    async ({ team_id, issue_id, dependency_id }) => {
      await apiRequest(
        `/api/v1/teams/${team_id}/issues/${issue_id}/issue_dependencies/${dependency_id}`,
        { method: "DELETE" }
      );
      return {
        content: [
          {
            type: "text",
            text: `Dependency ${dependency_id} removed successfully.`,
          },
        ],
      };
    }
  );
}
