# Architecture

InfraSteward uses Tauri 2, React, TypeScript, and Rust as required.

The frontend is a Vite React app in `src/`. It owns the tabbed workspace UI, modal workflows, script manager, parameter settings, and logs panel. Shared TypeScript domain logic lives in `src/lib/` so tests can cover script parsing, command construction, persistence normalization, and MCP tool generation without a desktop runtime.

The backend is a Tauri Rust crate in `src-tauri/`. It exposes commands for app-data loading/saving, SSH connection saving, connection testing, and remote script execution. Non-secret data is stored as JSON in the standard per-user app data directory. Writes use a temporary file followed by rename.

Secrets are isolated behind a Rust `SecretStore` abstraction. It tries the OS keychain through the `keyring` crate first. If that fails, it refuses to save secrets unless the user explicitly allows insecure fallback storage.

SSH execution uses the `ssh2` crate. Manual parameter values are passed as environment assignments to a heredoc command, avoiding text replacement inside script content.

MCP support is implemented as a local `mcp-server` package. It generates tools from enabled workspace scripts and exposes them over stdio. Execution routing is through an adapter command (`INFRASTEWARD_MCP_EXECUTOR`) so the server can be integrated with the desktop runtime or a future local bridge.

Documentation sources checked with Context7: Tauri command/event docs, React form/focus guidance, and Model Context Protocol TypeScript SDK stdio/tool registration examples.
