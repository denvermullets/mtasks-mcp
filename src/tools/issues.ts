import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

const priorityEnum = z
  .enum(["urgent", "high", "medium", "low", "no_priority"])
  .describe("Issue priority");

interface Lane {
  id: number;
  name: string;
  position: number;
  color: string;
}

interface Issue {
  id: number;
  identifier: string;
  title: string;
  description?: string;
  priority: string;
  estimate: number | null;
  due_date: string | null;
  lane: { id: number; name: string };
  assignee: { id: number; name: string } | null;
  creator: { id: number; name: string };
  project: { id: number; name: string } | null;
  labels: { id: number; name: string }[];
  milestone?: { id: number; name: string } | null;
  parent_issue?: { id: number; identifier: string; title: string } | null;
  blocking_issues?: { id: number; identifier: string; title: string }[];
  blocked_issues?: { id: number; identifier: string; title: string }[];
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export function formatIssue(issue: Issue, detailed = false): string {
  const lines = [
    `**${issue.identifier}**: ${issue.title}`,
    `  Status: ${issue.lane.name} | Priority: ${issue.priority} | ID: ${issue.id}`,
  ];
  if (issue.assignee) lines.push(`  Assignee: ${issue.assignee.name}`);
  if (issue.project) lines.push(`  Project: ${issue.project.name}`);
  if (issue.labels.length > 0)
    lines.push(`  Labels: ${issue.labels.map((l) => l.name).join(", ")}`);
  if (issue.due_date) lines.push(`  Due: ${issue.due_date}`);
  if (issue.estimate !== null) lines.push(`  Estimate: ${issue.estimate}`);
  if (detailed) {
    if (issue.description) lines.push(`  Description: ${issue.description}`);
    if (issue.milestone) lines.push(`  Milestone: ${issue.milestone.name}`);
    if (issue.parent_issue)
      lines.push(
        `  Parent: ${issue.parent_issue.identifier} — ${issue.parent_issue.title}`
      );
    // API semantics (from the Rails issue serializer / associations):
    //   blocked_issues  = issues THIS issue blocks (its dependents) -> "Blocking:"
    //   blocking_issues = issues that block THIS issue (its blockers) -> "Blocked by:"
    if (issue.blocked_issues && issue.blocked_issues.length > 0)
      lines.push(
        `  Blocking: ${issue.blocked_issues.map((i) => `${i.identifier} (${i.title})`).join(", ")}`
      );
    if (issue.blocking_issues && issue.blocking_issues.length > 0)
      lines.push(
        `  Blocked by: ${issue.blocking_issues.map((i) => `${i.identifier} (${i.title})`).join(", ")}`
      );
    lines.push(`  Creator: ${issue.creator.name}`);
    lines.push(`  Created: ${issue.created_at}`);
    lines.push(`  Updated: ${issue.updated_at}`);
    if (issue.started_at) lines.push(`  Started: ${issue.started_at}`);
    if (issue.completed_at) lines.push(`  Completed: ${issue.completed_at}`);
    if (issue.canceled_at) lines.push(`  Canceled: ${issue.canceled_at}`);
  }
  return lines.join("\n");
}

export function registerIssueTools(server: McpServer) {
  server.tool(
    "list_issues",
    "List issues for a team, with optional filters",
    {
      team_id: z.number().describe("Team ID"),
      lane_id: z.number().optional().describe("Filter by status lane ID"),
      assignee_id: z.number().optional().describe("Filter by assignee ID"),
      project_id: z.number().optional().describe("Filter by project ID"),
      priority: priorityEnum.optional(),
    },
    async ({ team_id, lane_id, assignee_id, project_id, priority }) => {
      const issues = await apiRequest<Issue[]>(
        `/api/v1/teams/${team_id}/issues`,
        {
          params: {
            lane_id: lane_id,
            assignee_id: assignee_id,
            project_id: project_id,
            priority,
          },
        }
      );
      const text = issues.map((i) => formatIssue(i)).join("\n\n");
      return {
        content: [{ type: "text", text: text || "No issues found." }],
      };
    }
  );

  server.tool(
    "get_issue",
    "Get full details of a specific issue",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Issue ID"),
    },
    async ({ team_id, issue_id }) => {
      const issue = await apiRequest<Issue>(
        `/api/v1/teams/${team_id}/issues/${issue_id}`
      );
      return {
        content: [{ type: "text", text: formatIssue(issue, true) }],
      };
    }
  );

  server.tool(
    "create_issue",
    "Create a new issue on a team. If lane_id is omitted, defaults to the Backlog lane.",
    {
      team_id: z.number().describe("Team ID"),
      title: z.string().describe("Issue title"),
      description: z.string().optional().describe("Issue description"),
      priority: priorityEnum.optional().describe("Defaults to no_priority"),
      lane_id: z
        .number()
        .optional()
        .describe("Status lane ID. Defaults to Backlog if omitted."),
      assignee_id: z.number().optional().describe("Assignee user ID"),
      project_id: z.number().optional().describe("Project ID"),
      label_ids: z.array(z.number()).optional().describe("Label IDs"),
      due_date: z
        .string()
        .optional()
        .describe("Due date in YYYY-MM-DD format"),
      estimate: z.number().optional().describe("Estimate value"),
      milestone_id: z.number().optional().describe("Milestone ID"),
      parent_issue_id: z.number().optional().describe("Parent issue ID"),
    },
    async ({
      team_id,
      title,
      description,
      priority,
      lane_id,
      assignee_id,
      project_id,
      label_ids,
      due_date,
      estimate,
      milestone_id,
      parent_issue_id,
    }) => {
      let resolvedLaneId = lane_id;
      if (!resolvedLaneId) {
        const lanes = await apiRequest<Lane[]>(
          `/api/v1/teams/${team_id}/lanes`
        );
        const backlog = lanes.find(
          (l) => l.name.toLowerCase() === "backlog" || l.position === 0
        );
        if (!backlog) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Could not find a Backlog lane. Please specify a lane_id.",
              },
            ],
          };
        }
        resolvedLaneId = backlog.id;
      }

      const issue = await apiRequest<Issue>(
        `/api/v1/teams/${team_id}/issues`,
        {
          method: "POST",
          body: {
            issue: {
              title,
              description,
              priority: priority || "no_priority",
              lane_id: resolvedLaneId,
              assignee_id,
              project_id,
              label_ids,
              due_date,
              estimate,
              milestone_id,
              parent_issue_id,
            },
          },
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Issue created successfully:\n\n${formatIssue(issue, true)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_issue",
    "Update an existing issue (change priority, reassign, move lane, etc.)",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Issue ID"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      priority: priorityEnum.optional(),
      lane_id: z.number().optional().describe("Move to lane ID"),
      assignee_id: z.number().optional().describe("Reassign to user ID"),
      project_id: z.number().optional().describe("Move to project ID"),
      label_ids: z.array(z.number()).optional().describe("Set label IDs"),
      due_date: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      estimate: z.number().optional().describe("Estimate value"),
    },
    async ({
      team_id,
      issue_id,
      title,
      description,
      priority,
      lane_id,
      assignee_id,
      project_id,
      label_ids,
      due_date,
      estimate,
    }) => {
      const fields: Record<string, unknown> = {};
      if (title !== undefined) fields.title = title;
      if (description !== undefined) fields.description = description;
      if (priority !== undefined) fields.priority = priority;
      if (lane_id !== undefined) fields.lane_id = lane_id;
      if (assignee_id !== undefined) fields.assignee_id = assignee_id;
      if (project_id !== undefined) fields.project_id = project_id;
      if (label_ids !== undefined) fields.label_ids = label_ids;
      if (due_date !== undefined) fields.due_date = due_date;
      if (estimate !== undefined) fields.estimate = estimate;

      const issue = await apiRequest<Issue>(
        `/api/v1/teams/${team_id}/issues/${issue_id}`,
        {
          method: "PATCH",
          body: { issue: fields },
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Issue updated successfully:\n\n${formatIssue(issue, true)}`,
          },
        ],
      };
    }
  );
}
