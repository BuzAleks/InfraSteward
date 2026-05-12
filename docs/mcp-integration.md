# MCP Integration

MCP lets an LLM client call selected InfraSteward scripts as tools. This is dangerous by default because tool calls can execute remote commands over SSH.

MCP is disabled by default for every attached script. Select attached scripts in the main window and use the `MCP` checkbox below the script list only after reviewing the scripts and target server.

Tool names are generated from connection name, script name, and attachment tag, normalized to lowercase snake case. For example, connection `REG.RU`, script `LOGS`, and tag `default` becomes `reg_ru_logs_default`. Collisions still receive a deterministic suffix based on the attached script id. Tool descriptions include the attachment description first, then the base script description when both are present.

Tool input schemas are generated from detected script variables. Each variable is an optional string so omitted values can fall back to script-specific overrides, workspace settings, selected local environment values, the remote environment, or shell defaults.

Every MCP tool also accepts optional `timeoutSeconds`. It may be passed as an integer or a numeric string, defaults to `30`, is clamped to a maximum of `60`, and is enforced inside the desktop app so long-running scripts such as `docker compose logs -f` return with `status: "timeout"` instead of running forever.

In the desktop app, press **MCP** on the right side of the tab bar. The app starts a local bridge at `http://127.0.0.1:47321`.

Configure the MCP client to run the stdio wrapper from this repository:

```json
{
  "mcpServers": {
    "infrasteward": {
      "command": "npm.cmd",
      "args": ["run", "mcp:dev"],
      "cwd": "C:\\Users\\aleks\\vscprojects\\InfraSteward"
    }
  }
}
```

The stdio wrapper discovers tools and executes scripts through the desktop app bridge. Set `INFRASTEWARD_MCP_BRIDGE_URL` only if the bridge port is changed in a custom build. Legacy `INFRASTEWARD_APP_DATA` and `INFRASTEWARD_MCP_EXECUTOR` fallback is still supported for adapter-based experiments, but normal use does not need those variables.

Do not expose the bridge publicly. It binds to `127.0.0.1` by default. Use least-privileged SSH users and avoid enabling destructive scripts.
