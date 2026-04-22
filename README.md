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


----

#### old notes to remove later:
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

---

## Release / publish notes (for maintainer)

Publishing a new version to npm. `npm version <type>` bumps `package.json`, commits, and tags in one shot — use it after merging to `main` so the tag points at the merge commit.

```bash
# from main, after your PR is merged
git checkout main && git pull

npm version patch   # 1.0.1 → 1.0.2  (bug fixes)
npm version minor   # 1.0.1 → 1.1.0  (new features, backwards compatible)
npm version major   # 1.0.1 → 2.0.0  (breaking changes)

git push && git push --tags
npm publish
```

If you hand-tagged already (`git tag v1.0.1`) and then `npm publish` fails with "cannot publish over previously published versions", it means you forgot to bump `package.json`. Either edit the version manually and commit, or drop the tag and use `npm version` as above.

Verify after publish:
```bash
npm view @denvermullets/jait
npx -y @denvermullets/jait@latest --help   # sanity check the bin still works
```
