# Dependency Research

Context7 documentation checked before implementation:

- Tauri docs: commands, shared state, frontend invocation, and event/channel examples.
- React docs: labeled inputs, form state, focus behavior, and accessible controls.
- Model Context Protocol TypeScript SDK docs: stdio server creation and tool registration patterns.

Selected libraries:

- Tauri 2 for the cross-platform desktop shell and Rust command bridge.
- React 19 with TypeScript for maintainable UI.
- Vite for frontend development and build.
- `lucide-react` for accessible toolbar/action icons.
- Rust `ssh2` for SSH command execution.
- Rust `keyring` for secure credential storage.
- MCP TypeScript SDK for stdio server integration.
- Vitest for fast unit tests around parsing, storage, command construction, and MCP registry behavior.

Important notes:

- Tauri command invocation uses `invoke` from `@tauri-apps/api/core`.
- Tauri backend state should be wrapped in `Mutex` for command access.
- MCP tools are stdio-local by default; this matches the security model better than a public HTTP listener.
- True live SSH streaming should use Tauri events or channels in a future iteration.
