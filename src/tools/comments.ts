import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

interface CommentUser {
  id: number;
  name: string;
  email: string;
}

interface Comment {
  id: number;
  body: string;
  parent_id: number | null;
  user: CommentUser | null;
  created_at: string;
  updated_at: string;
  replies?: Comment[];
}

function formatComment(comment: Comment, indent = 0): string {
  const pad = "  ".repeat(indent);
  const author = comment.user ? comment.user.name : "Unknown";
  const lines = [
    `${pad}#${comment.id} by ${author} at ${comment.created_at}`,
    `${pad}  ${comment.body}`,
  ];
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
    "Post a new comment on an issue. The author is derived from the API token. Pass parent_id to reply to an existing comment.",
    {
      team_id: z.number().describe("Team ID"),
      issue_id: z.number().describe("Issue ID"),
      body: z.string().describe("Comment text"),
      parent_id: z
        .number()
        .optional()
        .describe("Parent comment ID to reply to"),
    },
    async ({ team_id, issue_id, body, parent_id }) => {
      const comment = await apiRequest<Comment>(
        `/api/v1/teams/${team_id}/issues/${issue_id}/comments`,
        {
          method: "POST",
          body: { comment: { body, parent_id } },
        }
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
