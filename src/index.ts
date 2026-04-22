#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTeamTools } from "./tools/teams.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerLaneTools } from "./tools/lanes.js";
import { registerMemberTools } from "./tools/members.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerIssueDependencyTools } from "./tools/issue-dependencies.js";
import { writeToken, clearToken } from "./config-store.js";

const [, , cmd, arg] = process.argv;

if (cmd === "login") {
  if (!arg) {
    console.error("Usage: jait login <token>");
    process.exit(1);
  }
  const path = writeToken(arg);
  console.log(`Token saved to ${path}`);
  process.exit(0);
}

if (cmd === "logout") {
  const removed = clearToken();
  console.log(removed ? "Token cleared." : "No token found.");
  process.exit(0);
}

const server = new McpServer({
  name: "jait",
  version: "1.0.0",
});

registerTeamTools(server);
registerIssueTools(server);
registerIssueDependencyTools(server);
registerLaneTools(server);
registerMemberTools(server);
registerLabelTools(server);
registerProjectTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
