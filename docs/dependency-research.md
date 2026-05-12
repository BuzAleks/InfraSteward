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
- Rust `windows-sys` for direct Windows Credential Manager integration.
- Rust `keyring` for secure credential storage on non-Windows platforms and legacy migration fallback.
- MCP TypeScript SDK for stdio server integration.
- Vitest for fast unit tests around parsing, storage, command construction, and MCP registry behavior.

Important notes:

- Tauri command invocation uses `invoke` from `@tauri-apps/api/core`.
- Tauri backend state should be wrapped in `Mutex` for command access.
- MCP clients talk to a stdio wrapper; the wrapper talks to the desktop app through a loopback-only HTTP bridge.
- Live SSH output is streamed through backend event queues polled by the frontend.
