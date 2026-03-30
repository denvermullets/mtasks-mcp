#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTeamTools } from "./tools/teams.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerLaneTools } from "./tools/lanes.js";
import { registerMemberTools } from "./tools/members.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerProjectTools } from "./tools/projects.js";

const server = new McpServer({
  name: "mtasks",
  version: "1.0.0",
});

registerTeamTools(server);
registerIssueTools(server);
registerLaneTools(server);
registerMemberTools(server);
registerLabelTools(server);
registerProjectTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
