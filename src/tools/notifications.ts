import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../api-client.js";

// NotificationsController#serialize in the Rails app.
interface Notification {
  id: number;
  action: string;
  message: string;
  read_at: string | null;
  created_at: string;
  actor: { id: number; name: string };
  issue: { id: number; identifier: string; title: string; team_id: number };
  comment_id: number | null;
}

function formatNotification(n: Notification): string {
  const state = n.read_at ? "read" : "UNREAD";
  return `[${state}] #${n.id} ${n.created_at} — ${n.message}\n  ${n.issue.identifier}: ${n.issue.title} (issue ID: ${n.issue.id}, team ID: ${n.issue.team_id})`;
}

export function registerNotificationTools(server: McpServer) {
  server.tool(
    "list_notifications",
    "List your notifications (assignments, comments, mentions, status changes on issues you follow), newest first.",
    {
      unread_only: z.boolean().optional().describe("Only unread notifications"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max notifications (default 50)"),
      before_id: z
        .number()
        .optional()
        .describe("Only notifications older than this notification ID, for paging"),
    },
    async ({ unread_only, limit, before_id }) => {
      const res = await apiRequest<{
        notifications: Notification[];
        meta: { unread_count: number };
      }>("/api/v1/notifications", {
        params: { unread: unread_only ? 1 : undefined, limit, before_id },
      });
      const header = `${res.meta.unread_count} unread`;
      const body = res.notifications.map(formatNotification).join("\n\n");
      return {
        content: [
          { type: "text", text: body ? `${header}\n\n${body}` : `${header}. No notifications found.` },
        ],
      };
    }
  );

  server.tool(
    "get_unread_notification_count",
    "Get how many unread notifications you have.",
    {},
    async () => {
      const res = await apiRequest<{ unread_count: number }>(
        "/api/v1/notifications/unread_count"
      );
      return {
        content: [{ type: "text", text: `${res.unread_count} unread notifications.` }],
      };
    }
  );

  server.tool(
    "mark_notification_read",
    "Mark one notification as read.",
    { notification_id: z.number().describe("Notification ID") },
    async ({ notification_id }) => {
      const n = await apiRequest<Notification>(
        `/api/v1/notifications/${notification_id}/read`,
        { method: "PATCH" }
      );
      return {
        content: [{ type: "text", text: `Marked read:\n${formatNotification(n)}` }],
      };
    }
  );

  server.tool(
    "mark_all_notifications_read",
    "Mark all your notifications as read, optionally only those for one team or created before a time.",
    {
      team_id: z.number().optional().describe("Only this team's notifications"),
      before: z
        .string()
        .optional()
        .describe("Only notifications created before this ISO 8601 timestamp"),
    },
    async ({ team_id, before }) => {
      const res = await apiRequest<{ marked: number; unread_count: number }>(
        "/api/v1/notifications/read_all",
        { method: "PATCH", params: { team_id, before } }
      );
      return {
        content: [
          {
            type: "text",
            text: `Marked ${res.marked} notifications read; ${res.unread_count} still unread.`,
          },
        ],
      };
    }
  );
}
