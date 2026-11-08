import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";
import { type Issue, formatIssue } from "./issues.js";

// Shape of GET /api/v1/teams/:team_id/issues/:issue_id/hierarchy
// (app/controllers/api/v1/issue_hierarchies_controller.rb in the Rails app).
export interface HierarchyNode {
  id: number;
  identifier: string;
  title: string;
  priority: string;
  lane: { id: number; name: string; category: string | null };
  assignee: { id: number; name: string } | null;
  closed: boolean;
  sub_issue_count: number;
  sub_issues: HierarchyNode[];
}

export interface Hierarchy {
  issue_id: number;
  root_id: number;
  ancestor_ids: number[];
  truncated: boolean;
  tree: HierarchyNode;
  blocks: { blocking_issue_id: number; blocked_issue_id: number }[];
}

export function formatHierarchy(h: Hierarchy): string {
  const byId = new Map<number, HierarchyNode>();
  const lines: string[] = [];

  const walk = (node: HierarchyNode, depth: number) => {
    byId.set(node.id, node);
    const marker = node.id === h.issue_id ? " ← this issue" : "";
    const assignee = node.assignee ? ` | ${node.assignee.name}` : "";
    const check = node.closed ? "[x]" : "[ ]";
    lines.push(
      `${"  ".repeat(depth)}- ${check} ${node.identifier}: ${node.title} (${node.lane.name} | ${node.priority}${assignee} | ID: ${node.id})${marker}`
    );
    for (const child of node.sub_issues) walk(child, depth + 1);
  };
  walk(h.tree, 0);

  if (h.truncated)
    lines.push("  … deeper levels omitted (raise max_depth to see more)");

  if (h.blocks.length > 0) {
    const name = (id: number) => byId.get(id)?.identifier ?? `#${id}`;
    lines.push("", "Blocking links within this tree:");
    for (const b of h.blocks)
      lines.push(
        `  ${name(b.blocking_issue_id)} blocks ${name(b.blocked_issue_id)}`
      );
  }
  return lines.join("\n");
}

export function registerSubIssueTools(server: McpServer) {
  server.tool(
    "get_issue_hierarchy",
    "Get the full sub-issue tree an issue belongs to, rooted at its top-level ancestor, with each issue's status and any blocking links between issues in the tree. For an issue's direct sub-issues only, get_issue is enough; to list them with filters, use list_issues with parent_issue_id.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Any issue in the tree"),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many levels below the root to include (1-10, default 10)"),
    },
    async ({ team_id, issue_id, max_depth }) => {
      const hierarchy = await apiRequest<Hierarchy>(
        `/api/v1/teams/${team_id}/issues/${issue_id}/hierarchy`,
        { params: { max_depth } }
      );
      return {
        content: [{ type: "text", text: formatHierarchy(hierarchy) }],
      };
    }
  );

  server.tool(
    "add_sub_issue",
    "Make an existing issue a sub-issue of another issue in the same team. If it already has a parent, it is moved under the new one. To create a brand-new sub-issue, use create_issue with parent_issue_id instead.",
    {
      team_id: z.number().describe("Team ID"),
      parent_issue_id: z.number().describe("The issue to nest under"),
      issue_id: z.number().describe("The issue that becomes the sub-issue"),
    },
    async ({ team_id, parent_issue_id, issue_id }) => {
      const issue = await apiRequest<Issue>(
        `/api/v1/teams/${team_id}/issues/${issue_id}`,
        { method: "PATCH", body: { issue: { parent_issue_id } } }
      );
      return {
        content: [
          {
            type: "text",
            text: `Sub-issue added under issue ${parent_issue_id}:\n\n${formatIssue(issue)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "remove_sub_issue",
    "Detach a sub-issue from its parent, making it a top-level issue. The issue itself is kept.",
    {
      team_id: z.number().describe("Team ID"),
      parent_issue_id: z
        .number()
        .describe("The current parent; checked so the wrong link isn't removed"),
      issue_id: z.number().describe("The sub-issue to detach"),
    },
    async ({ team_id, parent_issue_id, issue_id }) => {
      const current = await apiRequest<Issue>(
        `/api/v1/teams/${team_id}/issues/${issue_id}`
      );
      if (current.parent_issue_id !== parent_issue_id) {
        const actual = current.parent_issue
          ? `${current.parent_issue.identifier} (ID: ${current.parent_issue.id})`
          : "no parent";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${current.identifier} is not a sub-issue of issue ${parent_issue_id}; it has ${actual}. Nothing was changed.`,
            },
          ],
        };
      }
      const issue = await apiRequest<Issue>(
        `/api/v1/teams/${team_id}/issues/${issue_id}`,
        { method: "PATCH", body: { issue: { parent_issue_id: null } } }
      );
      return {
        content: [
          {
            type: "text",
            text: `Sub-issue detached; it is now top-level:\n\n${formatIssue(issue)}`,
          },
        ],
      };
    }
  );
}
