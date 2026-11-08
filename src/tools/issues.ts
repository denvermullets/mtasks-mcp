import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest, apiRequestWithHeaders } from "../api-client.js";
import {
  type Attachment,
  attachUploads,
  filePathsSchema,
  formatAttachments,
  uploadLocalFiles,
} from "../attachments.js";

const priorityEnum = z
  .enum(["urgent", "high", "medium", "low", "no_priority"])
  .describe("Issue priority");

interface Lane {
  id: number;
  name: string;
  position: number;
  color: string;
}

export interface Issue {
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
  files?: Attachment[];
  parent_issue_id?: number | null;
  parent_issue?: { id: number; identifier: string } | null;
  // Direct sub-issues only (detail responses); get_issue_hierarchy has the full tree.
  sub_issues?: {
    id: number;
    identifier: string;
    title: string;
    lane: { id: number; name: string } | null;
  }[];
  blocking_issues?: {
    id: number;
    identifier: string;
    title: string;
    dependency_id: number;
  }[];
  blocked_issues?: {
    id: number;
    identifier: string;
    title: string;
    dependency_id: number;
  }[];
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
  // List rows carry only the parent's id; detail rows render the full parent below.
  if (!detailed && issue.parent_issue_id)
    lines.push(`  Parent issue ID: ${issue.parent_issue_id}`);
  if (detailed) {
    if (issue.description) lines.push(`  Description: ${issue.description}`);
    if (issue.files && issue.files.length > 0)
      lines.push(`  Attachments: ${formatAttachments(issue.files)}`);
    if (issue.parent_issue)
      lines.push(
        `  Parent: ${issue.parent_issue.identifier} (ID: ${issue.parent_issue.id})`
      );
    if (issue.sub_issues && issue.sub_issues.length > 0)
      lines.push(
        `  Sub-issues: ${issue.sub_issues.map((i) => `${i.identifier} (${i.title}) [${i.lane?.name ?? "?"}, ID: ${i.id}]`).join(", ")}`
      );
    // API semantics (from the Rails issue serializer / associations):
    //   blocked_issues  = issues THIS issue blocks (its dependents) -> "Blocking:"
    //   blocking_issues = issues that block THIS issue (its blockers) -> "Blocked by:"
    // Each entry includes [dep #N], the IssueDependency record id, which is the
    // dependency_id required by remove_issue_dependency.
    if (issue.blocked_issues && issue.blocked_issues.length > 0)
      lines.push(
        `  Blocking: ${issue.blocked_issues.map((i) => `${i.identifier} (${i.title}) [dep #${i.dependency_id}]`).join(", ")}`
      );
    if (issue.blocking_issues && issue.blocking_issues.length > 0)
      lines.push(
        `  Blocked by: ${issue.blocking_issues.map((i) => `${i.identifier} (${i.title}) [dep #${i.dependency_id}]`).join(", ")}`
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

// create/update respond with the summary serializer, which omits attachments,
// so list what the attach call returned.
function attachedNote(attached: Attachment[]): string {
  if (attached.length === 0) return "";
  return `\n  Attached: ${formatAttachments(attached)}`;
}

function attachmentsPath(teamId: number, issueId: number): string {
  return `/api/v1/teams/${teamId}/issues/${issueId}/attachments`;
}

interface ActivityChange {
  field: string;
  from: unknown;
  to: unknown;
}

// One entry of GET .../issues/:id/activity or .../projects/:id/activity
// (Api::V1::ActivityEntrySerializer / ProjectActivityEntrySerializer).
export interface ActivityEntry {
  type: "version" | "dependency" | "comment" | "reference";
  id: number;
  cursor: string;
  created_at: string;
  actor?: { id: number; name: string } | null;
  user?: { id: number; name: string } | null;
  description?: string;
  changes?: ActivityChange[];
  comment?: { id: number; body: string | null; user: { name: string } | null };
  source_issue?: { identifier: string; title: string };
  source_type?: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return String(v.name ?? v.identifier ?? v.id ?? JSON.stringify(v));
  }
  return String(value);
}

export function formatActivityEntry(entry: ActivityEntry): string {
  const when = entry.created_at;
  switch (entry.type) {
    case "comment": {
      const c = entry.comment;
      const who = c?.user?.name ?? "Someone";
      return `${when} — ${who} commented (#${c?.id}): ${c?.body ?? ""}`;
    }
    case "reference": {
      const who = entry.user?.name ?? "Someone";
      const src = entry.source_issue;
      return `${when} — ${who} referenced this from ${src?.identifier} (${src?.title}) in a ${entry.source_type}`;
    }
    default: {
      const who = entry.actor?.name ?? "System";
      const changes = (entry.changes ?? [])
        .map((c) => `${c.field}: ${formatValue(c.from)} → ${formatValue(c.to)}`)
        .join("; ");
      return `${when} — ${who} ${entry.description ?? entry.type}${changes ? ` (${changes})` : ""}`;
    }
  }
}

export function formatActivityPage(
  entries: ActivityEntry[],
  nextBeforeId: string | null
): string {
  if (entries.length === 0) return "No activity found.";
  const lines = entries.map(formatActivityEntry);
  if (nextBeforeId)
    lines.push(`\nOlder entries exist: pass before_id "${nextBeforeId}" to see them.`);
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
      parent_issue_id: z
        .union([z.number(), z.literal("none")])
        .optional()
        .describe(
          "Filter by parent: an issue ID lists that issue's direct sub-issues; 'none' lists only top-level issues (no parent)"
        ),
    },
    async ({
      team_id,
      lane_id,
      assignee_id,
      project_id,
      priority,
      parent_issue_id,
    }) => {
      const issues = await apiRequest<Issue[]>(
        `/api/v1/teams/${team_id}/issues`,
        {
          params: {
            lane_id: lane_id,
            assignee_id: assignee_id,
            project_id: project_id,
            priority,
            parent_issue_id,
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
    "get_issue_by_identifier",
    "Get full details of an issue by its shortcode/identifier (e.g. 'CMZ-324'). The team is inferred from the identifier prefix, so no team_id is needed.",
    {
      identifier: z
        .string()
        .describe("Issue shortcode, e.g. 'CMZ-324' (case-insensitive)"),
    },
    async ({ identifier }) => {
      const normalized = identifier.trim().toUpperCase();
      if (!/^[A-Z]+-\d+$/.test(normalized)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: '${identifier}' is not a valid issue identifier. Expected a shortcode like 'CMZ-324'.`,
            },
          ],
        };
      }
      const issue = await apiRequest<Issue>(
        `/api/v1/issues/by_identifier/${encodeURIComponent(normalized)}`
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
      parent_issue_id: z
        .number()
        .optional()
        .describe(
          "Parent issue ID — creates this issue as a sub-issue of that issue (same team only)"
        ),
      file_paths: filePathsSchema,
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
      parent_issue_id,
      file_paths,
    }) => {
      // Upload before creating, so a bad file fails the call with nothing created.
      const uploads = await uploadLocalFiles(file_paths);

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

      const fields = {
        title,
        description,
        priority: priority || "no_priority",
        lane_id: resolvedLaneId,
        assignee_id,
        project_id,
        label_ids,
        due_date,
        estimate,
        parent_issue_id,
      };
      const issue = await apiRequest<Issue>(`/api/v1/teams/${team_id}/issues`, {
        method: "POST",
        body: { issue: fields },
      });
      const attached = await attachUploads(
        attachmentsPath(team_id, issue.id),
        uploads
      );
      return {
        content: [
          {
            type: "text",
            text: `Issue created successfully:\n\n${formatIssue(issue, true)}${attachedNote(attached)}`,
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
      parent_issue_id: z
        .number()
        .nullable()
        .optional()
        .describe(
          "Set the parent issue (makes this a sub-issue of it, same team only), or null to detach it and make it top-level"
        ),
      file_paths: filePathsSchema,
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
      parent_issue_id,
      file_paths,
    }) => {
      const uploads = await uploadLocalFiles(file_paths);
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
      if (parent_issue_id !== undefined) fields.parent_issue_id = parent_issue_id;

      if (Object.keys(fields).length === 0 && uploads.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "Error: Nothing to update." },
          ],
        };
      }

      const issuePath = `/api/v1/teams/${team_id}/issues/${issue_id}`;
      // The API rejects an empty `issue` object, so an attach-only call skips the PATCH.
      const issue =
        Object.keys(fields).length > 0
          ? await apiRequest<Issue>(issuePath, {
              method: "PATCH",
              body: { issue: fields },
            })
          : await apiRequest<Issue>(issuePath);
      const attached = await attachUploads(
        attachmentsPath(team_id, issue_id),
        uploads
      );
      return {
        content: [
          {
            type: "text",
            text: `Issue updated successfully:\n\n${formatIssue(issue, true)}${attachedNote(attached)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "remove_issue_attachment",
    "Remove a file attached to an issue. Get the attachment ID from get_issue.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Issue ID"),
      attachment_id: z.number().describe("Attachment ID (shown by get_issue)"),
    },
    async ({ team_id, issue_id, attachment_id }) => {
      await apiRequest(`${attachmentsPath(team_id, issue_id)}/${attachment_id}`, {
        method: "DELETE",
      });
      return {
        content: [
          { type: "text", text: `Attachment ${attachment_id} removed.` },
        ],
      };
    }
  );

  server.tool(
    "move_issue",
    "Move an issue to another team you belong to. It is renumbered there (new identifier). The lane is matched by name (else the team's first lane), the assignee is kept only if they are a member of the target team, and the project, labels and parent/sub-issue links are cleared.",
    {
      team_id: z.number().describe("The issue's current team ID"),
      issue_id: z.number().describe("Issue ID"),
      target_team_id: z.number().describe("Team ID to move the issue to"),
    },
    async ({ team_id, issue_id, target_team_id }) => {
      const issue = await apiRequest<Issue>(
        `/api/v1/teams/${team_id}/issues/${issue_id}/move`,
        { method: "PATCH", body: { target_team_id } }
      );
      return {
        content: [
          {
            type: "text",
            text: `Issue moved:\n\n${formatIssue(issue, true)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_issue_activity",
    "Get an issue's history: field changes, dependency changes, comments and references from other issues, oldest first. Returns the newest `limit` entries; page back with before_id.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Issue ID"),
      types: z
        .array(z.enum(["versions", "dependencies", "comments", "references"]))
        .optional()
        .describe("Only these entry types (default: all)"),
      since: z
        .string()
        .optional()
        .describe("Only entries after this ISO 8601 timestamp"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Max entries (default 100)"),
      before_id: z
        .string()
        .optional()
        .describe("Cursor from a previous call, to get older entries"),
    },
    async ({ team_id, issue_id, types, since, limit, before_id }) => {
      const { data, headers } = await apiRequestWithHeaders<ActivityEntry[]>(
        `/api/v1/teams/${team_id}/issues/${issue_id}/activity`,
        { params: { types: types?.join(","), since, limit, before_id } }
      );
      return {
        content: [
          {
            type: "text",
            text: formatActivityPage(data, headers.get("X-Next-Before-Id")),
          },
        ],
      };
    }
  );
}
