import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

const priorityEnum = z
  .enum(["urgent", "high", "medium", "low", "no_priority"])
  .describe("Priority of each issue it files");

// Api::V1::RecurringIssueSerializer
interface RecurringIssue {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  weekday: number | null;
  day_of_month: number | null;
  time_zone: string;
  active: boolean;
  next_run_on: string | null;
  last_run_at: string | null;
  schedule_summary: string;
  assignee: { id: number; name: string } | null;
  project: { id: number; name: string } | null;
  lane: { id: number; name: string } | null;
  label_ids: number[];
}

function formatRecurringIssue(r: RecurringIssue): string {
  const lines = [
    `**${r.title}** — ID: ${r.id}${r.active ? "" : " (paused)"}`,
    `  Schedule: ${r.schedule_summary} (${r.time_zone}) | Next: ${r.next_run_on ?? "none"}`,
    `  Priority: ${r.priority}`,
  ];
  if (r.assignee) lines.push(`  Assignee: ${r.assignee.name}`);
  if (r.project) lines.push(`  Project: ${r.project.name}`);
  if (r.lane) lines.push(`  Lane: ${r.lane.name}`);
  if (r.label_ids.length > 0) lines.push(`  Label IDs: ${r.label_ids.join(", ")}`);
  if (r.last_run_at) lines.push(`  Last filed: ${r.last_run_at}`);
  if (r.description) lines.push(`  Description: ${r.description}`);
  return lines.join("\n");
}

// Shared by create and update; every field is optional here and create
// marks its required ones below.
const scheduleFields = {
  title: z.string().describe("Title of each issue it files"),
  description: z.string().describe("Description of each issue it files"),
  priority: priorityEnum,
  assignee_id: z.number().describe("Assignee user ID"),
  project_id: z.number().describe("Project ID"),
  lane_id: z.number().describe("Lane the issues start in (default: the team's first lane)"),
  label_ids: z.array(z.number()).describe("Label IDs"),
  frequency: z.enum(["daily", "weekly", "monthly"]).describe("How often it repeats"),
  interval: z
    .number()
    .int()
    .min(1)
    .max(365)
    .describe("Every N days/weeks/months (default 1)"),
  weekday: z
    .number()
    .int()
    .min(0)
    .max(6)
    .describe("For weekly: day of week, 0 = Sunday … 6 = Saturday"),
  day_of_month: z
    .number()
    .int()
    .min(1)
    .max(31)
    .describe("For monthly: day of month (clamped to the month's last day)"),
  time_zone: z
    .string()
    .describe("Rails time zone name, e.g. 'Eastern Time (US & Canada)' (default: yours)"),
  starts_on: z
    .string()
    .describe("YYYY-MM-DD; the first issue is filed on the first matching day on or after this (never before today)"),
};

type ScheduleArgs = {
  [K in keyof typeof scheduleFields]?: z.infer<(typeof scheduleFields)[K]>;
} & { active?: boolean };

function toBody(args: ScheduleArgs): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) fields[key] = value;
  }
  return fields;
}

export function registerRecurringIssueTools(server: McpServer) {
  server.tool(
    "list_recurring_issues",
    "List a team's recurring issue templates (issues filed automatically on a schedule).",
    { team_id: z.number().describe("Team ID") },
    async ({ team_id }) => {
      const list = await apiRequest<RecurringIssue[]>(
        `/api/v1/teams/${team_id}/recurring_issues`
      );
      const text = list.map(formatRecurringIssue).join("\n\n");
      return {
        content: [{ type: "text", text: text || "No recurring issues found." }],
      };
    }
  );

  server.tool(
    "create_recurring_issue",
    "Create a recurring issue: a template that files a fresh issue on a schedule (e.g. every Friday). Weekly needs weekday; monthly needs day_of_month.",
    {
      team_id: z.number().describe("Team ID"),
      ...scheduleFields,
      description: scheduleFields.description.optional(),
      priority: scheduleFields.priority.optional(),
      assignee_id: scheduleFields.assignee_id.optional(),
      project_id: scheduleFields.project_id.optional(),
      lane_id: scheduleFields.lane_id.optional(),
      label_ids: scheduleFields.label_ids.optional(),
      interval: scheduleFields.interval.optional(),
      weekday: scheduleFields.weekday.optional(),
      day_of_month: scheduleFields.day_of_month.optional(),
      time_zone: scheduleFields.time_zone.optional(),
    },
    async ({ team_id, ...args }) => {
      const r = await apiRequest<RecurringIssue>(
        `/api/v1/teams/${team_id}/recurring_issues`,
        {
          method: "POST",
          body: { recurring_issue: { interval: 1, ...toBody(args) } },
        }
      );
      return {
        content: [
          { type: "text", text: `Recurring issue created:\n\n${formatRecurringIssue(r)}` },
        ],
      };
    }
  );

  server.tool(
    "update_recurring_issue",
    "Update a recurring issue template, or pause/resume it with `active`. Changing the frequency, interval, weekday or day_of_month only takes effect on the next run date when starts_on is also given.",
    {
      team_id: z.number().describe("Team ID"),
      recurring_issue_id: z.number().describe("Recurring issue ID"),
      ...Object.fromEntries(
        Object.entries(scheduleFields).map(([k, v]) => [k, v.optional()])
      ) as { [K in keyof typeof scheduleFields]: z.ZodOptional<(typeof scheduleFields)[K]> },
      active: z.boolean().optional().describe("false pauses it, true resumes it"),
    },
    async ({ team_id, recurring_issue_id, ...args }) => {
      const fields = toBody(args as ScheduleArgs);
      if (Object.keys(fields).length === 0) {
        return {
          content: [{ type: "text" as const, text: "Error: Nothing to update." }],
        };
      }
      const r = await apiRequest<RecurringIssue>(
        `/api/v1/teams/${team_id}/recurring_issues/${recurring_issue_id}`,
        { method: "PATCH", body: { recurring_issue: fields } }
      );
      return {
        content: [
          { type: "text", text: `Recurring issue updated:\n\n${formatRecurringIssue(r)}` },
        ],
      };
    }
  );

  server.tool(
    "delete_recurring_issue",
    "Delete a recurring issue template. Issues it already filed are kept.",
    {
      team_id: z.number().describe("Team ID"),
      recurring_issue_id: z.number().describe("Recurring issue ID"),
    },
    async ({ team_id, recurring_issue_id }) => {
      await apiRequest(
        `/api/v1/teams/${team_id}/recurring_issues/${recurring_issue_id}`,
        { method: "DELETE" }
      );
      return {
        content: [
          { type: "text", text: `Recurring issue ${recurring_issue_id} deleted.` },
        ],
      };
    }
  );
}
