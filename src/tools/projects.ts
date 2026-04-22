import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

const projectStatusEnum = z
  .enum(["backlog", "started", "paused", "completed", "cancelled"])
  .describe("Project status");

const priorityEnum = z
  .enum(["urgent", "high", "medium", "low", "no_priority"])
  .describe("Priority level");

const roadmapCommitmentEnum = z
  .enum(["now", "next", "later"])
  .describe(
    'Roadmap commitment lane: "now" (shipping in ~6 weeks), "next" (up after Now), "later" (on the radar). Omit to leave unchanged; pass null to remove from roadmap.'
  );

interface Project {
  id: number;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  lead: { id: number; name: string } | null;
  start_date: string | null;
  due_date: string | null;
  milestone: { id: number; name: string } | null;
  labels: { id: number; name: string }[];
  issues_count: number;
  roadmap_commitment: "now" | "next" | "later" | null;
  created_at: string;
  updated_at: string;
}

function formatProject(project: Project, detailed = false): string {
  const lines = [
    `**${project.name}** — ID: ${project.id}`,
    `  Status: ${project.status} | Priority: ${project.priority}`,
  ];
  if (project.lead) lines.push(`  Lead: ${project.lead.name}`);
  if (project.description) lines.push(`  Description: ${project.description}`);
  if (project.start_date) lines.push(`  Start: ${project.start_date}`);
  if (project.due_date) lines.push(`  Due: ${project.due_date}`);
  if (project.roadmap_commitment)
    lines.push(`  Roadmap: ${project.roadmap_commitment}`);
  if (detailed) {
    if (project.milestone) lines.push(`  Milestone: ${project.milestone.name}`);
    if (project.labels?.length > 0)
      lines.push(
        `  Labels: ${project.labels.map((l) => l.name).join(", ")}`
      );
    if (project.issues_count !== undefined)
      lines.push(`  Issues: ${project.issues_count}`);
    lines.push(`  Created: ${project.created_at}`);
    lines.push(`  Updated: ${project.updated_at}`);
  }
  return lines.join("\n");
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
      const text = projects.map((p) => formatProject(p)).join("\n\n");
      return {
        content: [{ type: "text", text: text || "No projects found." }],
      };
    }
  );

  server.tool(
    "get_project",
    "Get full details of a specific project",
    {
      team_id: z.number().describe("Team ID"),
      project_id: z.number().describe("Project ID"),
    },
    async ({ team_id, project_id }) => {
      const project = await apiRequest<Project>(
        `/api/v1/teams/${team_id}/projects/${project_id}`
      );
      return {
        content: [{ type: "text", text: formatProject(project, true) }],
      };
    }
  );

  server.tool(
    "create_project",
    "Create a new project for a team",
    {
      team_id: z.number().describe("Team ID"),
      name: z.string().describe("Project name"),
      description: z.string().optional().describe("Project description"),
      status: projectStatusEnum.optional().describe("Defaults to backlog"),
      priority: priorityEnum.optional().describe("Defaults to no_priority"),
      lead_id: z.number().optional().describe("Project lead user ID"),
      milestone_id: z.number().optional().describe("Milestone ID"),
      start_date: z
        .string()
        .optional()
        .describe("Start date in YYYY-MM-DD format"),
      due_date: z
        .string()
        .optional()
        .describe("Due date in YYYY-MM-DD format"),
      label_ids: z.array(z.number()).optional().describe("Label IDs"),
      roadmap_commitment: roadmapCommitmentEnum.optional(),
    },
    async ({
      team_id,
      name,
      description,
      status,
      priority,
      lead_id,
      milestone_id,
      start_date,
      due_date,
      label_ids,
      roadmap_commitment,
    }) => {
      const project = await apiRequest<Project>(
        `/api/v1/teams/${team_id}/projects`,
        {
          method: "POST",
          body: {
            project: {
              name,
              description,
              status: status || "backlog",
              priority: priority || "no_priority",
              lead_id,
              milestone_id,
              start_date,
              due_date,
              label_ids,
              roadmap_commitment,
            },
          },
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Project created successfully:\n\n${formatProject(project, true)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_project",
    "Update an existing project (change status, priority, lead, dates, etc.)",
    {
      team_id: z.number().describe("Team ID"),
      project_id: z.number().describe("Project ID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      status: projectStatusEnum.optional(),
      priority: priorityEnum.optional(),
      lead_id: z.number().optional().describe("New lead user ID"),
      milestone_id: z.number().optional().describe("Milestone ID"),
      start_date: z
        .string()
        .optional()
        .describe("Start date in YYYY-MM-DD format"),
      due_date: z
        .string()
        .optional()
        .describe("Due date in YYYY-MM-DD format"),
      label_ids: z.array(z.number()).optional().describe("Set label IDs"),
      roadmap_commitment: roadmapCommitmentEnum.nullable().optional(),
    },
    async ({
      team_id,
      project_id,
      name,
      description,
      status,
      priority,
      lead_id,
      milestone_id,
      start_date,
      due_date,
      label_ids,
      roadmap_commitment,
    }) => {
      const fields: Record<string, unknown> = {};
      if (name !== undefined) fields.name = name;
      if (description !== undefined) fields.description = description;
      if (status !== undefined) fields.status = status;
      if (priority !== undefined) fields.priority = priority;
      if (lead_id !== undefined) fields.lead_id = lead_id;
      if (milestone_id !== undefined) fields.milestone_id = milestone_id;
      if (start_date !== undefined) fields.start_date = start_date;
      if (due_date !== undefined) fields.due_date = due_date;
      if (label_ids !== undefined) fields.label_ids = label_ids;
      if (roadmap_commitment !== undefined)
        fields.roadmap_commitment = roadmap_commitment;

      const project = await apiRequest<Project>(
        `/api/v1/teams/${team_id}/projects/${project_id}`,
        {
          method: "PATCH",
          body: { project: fields },
        }
      );
      return {
        content: [
          {
            type: "text",
            text: `Project updated successfully:\n\n${formatProject(project, true)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_project",
    "Delete a project from a team",
    {
      team_id: z.number().describe("Team ID"),
      project_id: z.number().describe("Project ID"),
    },
    async ({ team_id, project_id }) => {
      await apiRequest(
        `/api/v1/teams/${team_id}/projects/${project_id}`,
        { method: "DELETE" }
      );
      return {
        content: [
          { type: "text", text: `Project ${project_id} deleted successfully.` },
        ],
      };
    }
  );
}
