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