# Architecture

InfraSteward uses Tauri 2, React, TypeScript, and Rust as required.

The frontend is a Vite React app in `src/`. It owns the tabbed workspace UI, modal workflows, script manager, parameter settings, and logs panel. Shared TypeScript domain logic lives in `src/lib/` so tests can cover script parsing, command construction, persistence normalization, and MCP tool generation without a desktop runtime.

Global scripts are stored once, while workspaces store tagged attachments to those scripts. Multiple attachments can point to the same global script; each attachment has its own tag, parameter settings, and MCP flag.

Workspace attachment order is user-controlled and persisted as the `attachedScripts` array order. The main window runs one script at a time; selected attachments can be queued and are executed sequentially in that order.

The backend is a Tauri Rust crate in `src-tauri/`. It exposes commands for app-data loading/saving, SSH connection saving, connection testing, runtime path discovery, working-directory opening, MCP bridge control, and remote script execution. Non-secret data is stored as JSON in the configured working data directory. Writes use a temporary file followed by rename.

The working data directory is resolved from `INFRASTEWARD_DATA_DIR`, then on Windows from `HKCU\Software\InfraSteward\WorkingDataDir`, then from `data-dir.txt` in the app config directory, and finally from Tauri's standard app data directory. The Windows NSIS installer prompts for this directory and writes the registry value.

Secrets are isolated behind a Rust `SecretStore` abstraction. On Windows it writes directly to Windows Credential Manager; on other platforms it uses the OS keychain through the `keyring` crate. It refuses to save secrets to plaintext unless the user explicitly allows insecure fallback storage.

SSH execution uses the `ssh2` crate. Manual parameter values are passed as environment assignments to a heredoc command, avoiding text replacement inside script content. Stdout and stderr are streamed into the UI while the command runs, and cancellation/timeout closes the SSH channel.

MCP support is split between the desktop runtime and the local `mcp-server` package. The desktop app starts and stops a loopback HTTP bridge from the main toolbar, exposing enabled script metadata and execution on `127.0.0.1:47321`. The `mcp-server` package remains the stdio-facing MCP wrapper for clients such as Codex and forwards tool discovery/execution to that bridge. MCP executions accept `timeoutSeconds`, default to 30 seconds, and are capped at 60 seconds.

Documentation sources checked with Context7: Tauri command/event docs, React form/focus guidance, and Model Context Protocol TypeScript SDK stdio/tool registration examples.
