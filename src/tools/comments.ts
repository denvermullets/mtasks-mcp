import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";
import {
  type Attachment,
  buildMultipart,
  filePathsSchema,
  formatAttachments,
  readLocalFiles,
} from "../attachments.js";

interface CommentUser {
  id: number;
  name: string;
  email: string;
}

interface Comment {
  id: number;
  body: string | null;
  parent_id: number | null;
  user: CommentUser | null;
  attachments?: Attachment[];
  created_at: string;
  updated_at: string;
  replies?: Comment[];
}

function formatComment(comment: Comment, indent = 0): string {
  const pad = "  ".repeat(indent);
  const author = comment.user ? comment.user.name : "Unknown";
  const lines = [
    `${pad}#${comment.id} by ${author} at ${comment.created_at}`,
    `${pad}  ${comment.body ?? ""}`,
  ];
  if (comment.attachments && comment.attachments.length > 0) {
    lines.push(`${pad}  Attachments: ${formatAttachments(comment.attachments)}`);
  }
  if (comment.replies && comment.replies.length > 0) {
    for (const reply of comment.replies) {
      lines.push(formatComment(reply, indent + 1));
    }
  }
  return lines.join("\n");
}

export function registerCommentTools(server: McpServer) {
  server.tool(
    "list_comments",
    "List all comments on an issue, with replies nested under their parent.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Issue ID"),
    },
    async ({ team_id, issue_id }) => {
      const comments = await apiRequest<Comment[]>(
        `/api/v1/teams/${team_id}/issues/${issue_id}/comments`
      );
      const text = comments.map((c) => formatComment(c)).join("\n\n");
      return {
        content: [{ type: "text", text: text || "No comments on this issue." }],
      };
    }
  );

  server.tool(
    "create_comment",
    "Post a new comment on an issue. The author is derived from the API token. Pass parent_id to reply to an existing comment, and file_paths to attach local files.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Issue ID"),
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
    async ({ team_id, issue_id, body, parent_id, file_paths }) => {
      const files = await readLocalFiles(file_paths ?? []);
      const fields = { body, parent_id };
      const comment = await apiRequest<Comment>(
        `/api/v1/teams/${team_id}/issues/${issue_id}/comments`,
        files.length > 0
          ? { method: "POST", form: buildMultipart("comment", fields, files) }
          : { method: "POST", body: { comment: fields } }
      );
      return {
        content: [
          {
            type: "text",
            text: `Comment posted:\n${formatComment(comment)}`,
          },
        ],
      };
    }
  );
}
