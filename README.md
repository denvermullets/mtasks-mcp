```bash
claude mcp add my-server -- node /absolute/path/to/your/dist/index.js
```

just have to remember to put

```json
  "mcpServers": {
    "mtasks": {
      "command": "node",
      "args": ["BUILD_FILE_LOCATION"],
      "env": {
        "MTASKS_API_URL": "",
        "MTASKS_API_TOKEN": ""
      }
    }
  }
```

## Install

Install the published package from npm — no clone, no manual build.

### 1. Save your API token

Generate an API token in the JAIT web app, then store it locally:

```bash
npx -y @denvermullets/jait login <your-api-token>
```

This writes the token to `~/.config/jait/config.json` (mode `0600`) so it doesn't have to live in any client settings file.

### 2. Register the MCP server

**Claude Code (recommended):**

```bash
claude mcp add jait -- npx -y @denvermullets/jait
```

**Claude Desktop / Cursor / other clients:**

```json
{
  "mcpServers": {
    "jait": {
      "command": "npx",
      "args": ["-y", "@denvermullets/jait"]
    }
  }
}
```

No `env` block is needed — the token is read from the config file saved in step 1, and the API URL defaults to `https://justanotherissuetracker.com`.

### Logout

```bash
npx -y @denvermullets/jait logout
```

### Overrides (optional)

Both defaults can be overridden with environment variables, mostly useful for pointing at staging or localhost during development:

- `MTASKS_API_URL` — overrides the default production URL.
- `MTASKS_API_TOKEN` — overrides the saved token from `jait login`.