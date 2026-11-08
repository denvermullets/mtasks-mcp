import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";
import {
  type Attachment,
  filePathsSchema,
  formatAttachments,
  uploadLocalFiles,
} from "../attachments.js";

interface CommentUser {
  id: number;
  name: string;
  email: string;
}

// Api::V1::CommentSerializer. Team-feed rows add the owner fields.
export interface Comment {
  id: number;
  body: string | null;
  parent_id: number | null;
  user: CommentUser | null;
  files?: Attachment[];
  created_at: string;
  updated_at: string;
  replies?: Comment[];
  owner_type?: "Issue" | "Project";
  owner_id?: number;
}

export function formatComment(comment: Comment, indent = 0): string {
  const pad = "  ".repeat(indent);
  const author = comment.user ? comment.user.name : "Unknown";
  const owner = comment.owner_type
    ? ` on ${comment.owner_type.toLowerCase()} ${comment.owner_id}`
    : "";
  const reply = comment.parent_id && indent === 0 ? ` (reply to #${comment.parent_id})` : "";
  const lines = [
    `${pad}#${comment.id} by ${author}${owner}${reply} at ${comment.created_at}`,
    `${pad}  ${comment.body ?? ""}`,
  ];
  if (comment.files && comment.files.length > 0) {
    lines.push(`${pad}  Attachments: ${formatAttachments(comment.files)}`);
  }
  for (const r of comment.replies ?? []) {
    lines.push(formatComment(r, indent + 1));
  }
  return lines.join("\n");
}

// Issue and project comments share one shape; only the owner path differs.
const ownerSchema = {
  team_id: z.number().describe("Team ID"),
  issue_id: z
    .number()
    .optional()
    .describe("Issue ID (give exactly one of issue_id or project_id)"),
  project_id: z
    .number()
    .optional()
    .describe("Project ID (give exactly one of issue_id or project_id)"),
};

function commentsPath(args: {
  team_id: number;
  issue_id?: number;
  project_id?: number;
}): string {
  const { team_id, issue_id, project_id } = args;
  if ((issue_id === undefined) === (project_id === undefined)) {
    throw new Error("Give exactly one of issue_id or project_id.");
  }
  return issue_id !== undefined
    ? `/api/v1/teams/${team_id}/issues/${issue_id}/comments`
    : `/api/v1/teams/${team_id}/projects/${project_id}/comments`;
}

export function registerCommentTools(server: McpServer) {
  server.tool(
    "list_comments",
    "List all comments on an issue or a project, with replies nested under their parent.",
    ownerSchema,
    async (args) => {
      const comments = await apiRequest<Comment[]>(commentsPath(args));
      const text = comments.map((c) => formatComment(c)).join("\n\n");
      return {
        content: [{ type: "text", text: text || "No comments found." }],
      };
    }
  );

  server.tool(
    "create_comment",
    "Post a new comment on an issue or a project. The author is derived from the API token. Pass parent_id to reply to an existing comment, and file_paths to attach local files.",
    {
      ...ownerSchema,
      body: z
        .string()
        .optional()
        .describe("Comment text. May be omitted when file_paths is given."),
      parent_id: z
        .number()
        .optional()
        .describe("Parent comment ID to reply to"),
      file_paths: filePathsSchema,
    },
    async ({ body, parent_id, file_paths, ...owner }) => {
      const path = commentsPath(owner);
      const uploads = await uploadLocalFiles(file_paths);
      const comment = await apiRequest<Comment>(path, {
        method: "POST",
        body: {
          comment: { body, parent_id },
          files: uploads.map((u) => u.signedId),
        },
      });
      return {
        content: [
          { type: "text", text: `Comment posted:\n${formatComment(comment)}` },
        ],
      };
    }
  );

  server.tool(
    "delete_comment",
    "Delete a comment on an issue, along with its replies. Only the comment's author or a team admin can do this.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Issue ID"),
      comment_id: z.number().describe("Comment ID"),
    },
    async ({ team_id, issue_id, comment_id }) => {
      await apiRequest(
        `/api/v1/teams/${team_id}/issues/${issue_id}/comments/${comment_id}`,
        { method: "DELETE" }
      );
      return {
        content: [
          { type: "text", text: `Comment ${comment_id} deleted (with any replies).` },
        ],
      };
    }
  );

  server.tool(
    "remove_comment_attachment",
    "Remove a file from a comment on an issue or a project. Only the comment's author or a team admin can do this. Get the attachment ID from list_comments.",
    {
      ...ownerSchema,
      comment_id: z.number().describe("Comment ID"),
      attachment_id: z.number().describe("Attachment ID (shown by list_comments)"),
    },
    async ({ comment_id, attachment_id, ...owner }) => {
      await apiRequest(
        `${commentsPath(owner)}/${comment_id}/attachments/${attachment_id}`,
        { method: "DELETE" }
      );
      return {
        content: [
          {
            type: "text",
            text: `Attachment ${attachment_id} removed from comment ${comment_id}.`,
          },
        ],
      };
    }
  );

  server.tool(
    "list_team_comments",
    "List every issue and project comment in a team as one flat feed, oldest change first. Use updated_since to see only recent comments.",
    {
      team_id: z.number().describe("Team ID"),
      updated_since: z
        .string()
        .optional()
        .describe("Only comments created or edited at/after this ISO 8601 timestamp"),
    },
    async ({ team_id, updated_since }) => {
      const comments = await apiRequest<Comment[]>(
        `/api/v1/teams/${team_id}/comments`,
        { params: { updated_since } }
      );
      const text = comments.map((c) => formatComment(c)).join("\n\n");
      return {
        content: [{ type: "text", text: text || "No comments found." }],
      };
    }
  );
}
