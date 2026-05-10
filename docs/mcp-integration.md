# MCP Integration

MCP lets an LLM client call selected InfraSteward scripts as tools. This is dangerous by default because tool calls can execute remote commands over SSH.

MCP is disabled by default for every attached script. Enable `Use in MCP` from a script settings dialog only after reviewing the script and target server.

Tool names are generated from workspace title and script name, normalized to lowercase snake case. Collisions receive a deterministic suffix based on the attached script id.

Tool input schemas are generated from detected script variables. Each variable is an optional string so omitted values can fall back to the remote environment or shell defaults.

Run the stdio server with:

```json
{
  "mcpServers": {
    "infrasteward": {
      "command": "npm.cmd",
      "args": ["run", "mcp:dev"],
      "env": {
        "INFRASTEWARD_APP_DATA": "path-to-app-data.json",
        "INFRASTEWARD_MCP_EXECUTOR": "path-to-executor-adapter"
      }
    }
  }
}
```

The current MCP server implements registry generation and stdio tool exposure. Script execution is routed through `INFRASTEWARD_MCP_EXECUTOR`, which should accept `workspaceId`, `attachedScriptId`, and JSON arguments, then return an `ExecutionResult` JSON object.

Do not expose the MCP server publicly. Use least-privileged SSH users and avoid enabling destructive scripts.
