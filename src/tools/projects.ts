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
import {
  AmbiguousMatch,
  DuplicateHeading,
  SectionNotFound,
  TextNotFound,
  appendToSection,
  getSection,
  listSections,
  replaceSection,
  replaceText,
} from "../description-sections.js";
import { type ActivityEntry, formatActivityPage } from "./issues.js";

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
  labels: { id: number; name: string }[];
  issues_count: number;
  roadmap_commitment: "now" | "next" | "later" | null;
  files?: Attachment[];
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
    if (project.labels?.length > 0)
      lines.push(
        `  Labels: ${project.labels.map((l) => l.name).join(", ")}`
      );
    if (project.files && project.files.length > 0)
      lines.push(`  Attachments: ${formatAttachments(project.files)}`);
    if (project.issues_count !== undefined)
      lines.push(`  Issues: ${project.issues_count}`);
    lines.push(`  Created: ${project.created_at}`);
    lines.push(`  Updated: ${project.updated_at}`);
  }
  return lines.join("\n");
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const textResult = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
});

// Splicer errors are expected user-facing failures: show their message to the
// agent as an error result. Anything else (network, auth) propagates.
async function sectionOp(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return textResult(await fn());
  } catch (err) {
    if (
      err instanceof SectionNotFound ||
      err instanceof DuplicateHeading ||
      err instanceof TextNotFound ||
      err instanceof AmbiguousMatch
    ) {
      return { ...textResult(err.message), isError: true };
    }
    throw err;
  }
}

async function fetchDescription(
  team_id: number,
  project_id: number
): Promise<string> {
  const project = await apiRequest<Project>(
    `/api/v1/teams/${team_id}/projects/${project_id}`
  );
  return project.description ?? "";
}

async function saveDescription(
  team_id: number,
  project_id: number,
  description: string
): Promise<void> {
  await apiRequest<Project>(`/api/v1/teams/${team_id}/projects/${project_id}`, {
    method: "PATCH",
    body: { project: { description } },
  });
}

const sectionIds = {
  team_id: z.number().describe("Team ID"),
  project_id: z.number().describe("Project ID"),
};
const headingArg = z
  .string()
  .describe('Exact heading text without the leading #s, e.g. "Goals"');
const INSTEAD =
  " Use this instead of update_project for partial description edits.";

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

  server.tool(
    "add_project_attachments",
    "Attach local files to a project. Existing attachments are kept.",
    {
      team_id: z.number().describe("Team ID"),
      project_id: z.number().describe("Project ID"),
      file_paths: filePathsSchema.unwrap().min(1),
    },
    async ({ team_id, project_id, file_paths }) => {
      const uploads = await uploadLocalFiles(file_paths);
      const attached = await attachUploads(
        `/api/v1/teams/${team_id}/projects/${project_id}/attachments`,
        uploads
      );
      return {
        content: [
          {
            type: "text",
            text: `Attached to project ${project_id}: ${formatAttachments(attached)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "remove_project_attachment",
    "Remove a file attached to a project. Get the attachment ID from get_project.",
    {
      team_id: z.number().describe("Team ID"),
      project_id: z.number().describe("Project ID"),
      attachment_id: z.number().describe("Attachment ID (shown by get_project)"),
    },
    async ({ team_id, project_id, attachment_id }) => {
      await apiRequest(
        `/api/v1/teams/${team_id}/projects/${project_id}/attachments/${attachment_id}`,
        { method: "DELETE" }
      );
      return {
        content: [
          { type: "text", text: `Attachment ${attachment_id} removed.` },
        ],
      };
    }
  );

  server.tool(
    "get_project_activity",
    "Get a project's change history (name, description, status, priority, lead, dates, roadmap commitment), oldest first. Returns the newest `limit` entries; page back with before_id.",
    {
      team_id: z.number().describe("Team ID"),
      project_id: z.number().describe("Project ID"),
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
    async ({ team_id, project_id, since, limit, before_id }) => {
      const { data, headers } = await apiRequestWithHeaders<ActivityEntry[]>(
        `/api/v1/teams/${team_id}/projects/${project_id}/activity`,
        { params: { since, limit, before_id } }
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
  server.tool(
    "list_project_sections",
    "List the headings (with levels) in a project's description. Start here to see what sections exist before reading or editing one.",
    sectionIds,
    async ({ team_id, project_id }) =>
      sectionOp(async () => {
        const sections = listSections(
          await fetchDescription(team_id, project_id)
        );
        if (sections.length === 0) return "No sections found.";
        return sections
          .map((s) => `${"#".repeat(s.level)} ${s.heading}`)
          .join("\n");
      })
  );

  server.tool(
    "get_project_section",
    "Read the text of one section of a project's description (subsections included) without loading the whole description.",
    { ...sectionIds, heading: headingArg },
    async ({ team_id, project_id, heading }) =>
      sectionOp(async () =>
        getSection(await fetchDescription(team_id, project_id), { heading })
      )
  );

  server.tool(
    "replace_project_section",
    "Replace the body of one section of a project's description, keeping its heading. Pick this when rewriting most of a section; for adding to the end use append_to_project_section, for small tweaks use edit_project_description." +
      INSTEAD,
    {
      ...sectionIds,
      heading: headingArg,
      body: z.string().describe("New section body (heading not included)"),
    },
    async ({ team_id, project_id, heading, body }) =>
      sectionOp(async () => {
        const next = replaceSection(
          await fetchDescription(team_id, project_id),
          { heading, body }
        );
        await saveDescription(team_id, project_id, next);
        return `Replaced section "${heading}" in project ${project_id}.`;
      })
  );

  server.tool(
    "append_to_project_section",
    "Add text to the end of one section of a project's description. Pick this when adding to a section without touching what is there; to rewrite it use replace_project_section." +
      INSTEAD,
    {
      ...sectionIds,
      heading: headingArg,
      text: z.string().describe("Text to append"),
    },
    async ({ team_id, project_id, heading, text }) =>
      sectionOp(async () => {
        const next = appendToSection(
          await fetchDescription(team_id, project_id),
          { heading, text }
        );
        await saveDescription(team_id, project_id, next);
        return `Appended to section "${heading}" in project ${project_id}.`;
      })
  );

  server.tool(
    "edit_project_description",
    "Find-and-replace literal text in a project's description. Pick this for small edits inside a section (a word, a line, a checkbox); fails if old_string matches more than once unless replace_all is true." +
      INSTEAD,
    {
      ...sectionIds,
      old_string: z.string().describe("Exact text to find"),
      new_string: z.string().describe("Replacement text"),
      replace_all: z
        .boolean()
        .optional()
        .describe("Replace every match instead of requiring exactly one"),
    },
    async ({ team_id, project_id, old_string, new_string, replace_all }) =>
      sectionOp(async () => {
        const next = replaceText(await fetchDescription(team_id, project_id), {
          oldString: old_string,
          newString: new_string,
          replaceAll: replace_all,
        });
        await saveDescription(team_id, project_id, next);
        return `Edited description of project ${project_id}.`;
      })
  );
}
