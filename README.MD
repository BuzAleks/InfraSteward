# InfraSteward

InfraSteward is a desktop DevOps assistant for managing SSH workspaces and running reusable remote scripts. It gives you a focused place to save server connection profiles, attach automation scripts to each workspace, configure script parameters, and inspect execution logs without turning everyday server work into a pile of one-off terminal commands.

Built with **Tauri 2**, **React**, **TypeScript**, and **Rust**, InfraSteward keeps the interface lightweight while using a native backend for SSH execution and local storage.

## Highlights

- **Tabbed SSH workspaces** for different servers, environments, or projects.
- **Password and private-key authentication** through the Rust `ssh2` backend.
- **Secret-aware credential storage** using the OS keychain when available, with an explicit local fallback option.
- **Reusable global scripts** that can be attached to any workspace.
- **Parameter detection** for `${VAR}` style script inputs.
- **Per-workspace script settings** so the same global script can behave differently on different servers.
- **Execution logs** with status, stdout, stderr, timestamps, level filters, copy support, and exit codes.
- **Local MCP bridge support** for exposing trusted scripts as LLM-callable tools.

## Screens

InfraSteward is organized around a small set of practical views:

- **Workspace tabs**: create, rename, switch, and close server workspaces.
- **Connection Settings**: configure host, port, username, authentication type, timeouts, and credentials.
- **Script Manager**: create, edit, search, and delete reusable scripts.
- **Attached Scripts**: choose which scripts belong to the active workspace.
- **Logs**: review command output and execution history for the active workspace, or run a script in a separate log window.

## Getting Started

### Prerequisites

- Node.js 20 or newer
- Rust toolchain
- Tauri system prerequisites for your platform

On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1` through execution policy.

### Install

```bash
npm install
```

### Run In Development

```bash
npm.cmd run dev
```

### Build A Fresh Desktop Executable And Installer

```bash
npm.cmd run build
```

The Windows release executable and installer are written to:

```text
src-tauri/target/release/infrasteward.exe
src-tauri/target/release/bundle/nsis/InfraSteward_0.1.0_x64-setup.exe
```

To build the web frontend only:

```bash
npm.cmd run web:build
```

## Usage

1. Open **Connection Settings** and enter the server host, port, username, and authentication method.
2. Enter a password or private key details, then click **Test Connection**.
3. Open **Script Manager** and create reusable shell scripts.
4. Attach scripts to the active workspace.
5. Configure detected parameters in each script row's settings.
6. Click **Run** and review stdout, stderr, status, and exit code in the logs panel.

The active working data directory is shown in the main toolbar. Click it to open the directory in the system file explorer.

## Credential Storage

InfraSteward stores connection metadata in local app data, but it does not write plaintext passwords or private-key content into `app-data.json`.

Secrets are saved by reference, for example:

```text
conn_x:password
conn_x:private-key
conn_x:passphrase
```

On Windows, the backend stores secrets directly in Windows Credential Manager. On other platforms it uses the OS keychain through the `keyring` crate. If secure storage is unavailable, you can explicitly enable insecure fallback storage in **Connection Settings**. This fallback stores secrets in the working data directory and should only be used on a machine you control.

## Script Parameters

InfraSteward detects `${VAR}` and `${VAR:-default}` style variables in scripts. Bare `$VAR` references are ignored to avoid over-detecting internal shell variables. Manual values are passed to the remote shell as environment variables instead of being substituted directly into script text.

Example:

```bash
TARGET_PATH='/var/log' bash -s <<'INFRAS_EOF'
df -h "${TARGET_PATH:-/}"
INFRAS_EOF
```

If **Use from environment** is enabled for a parameter, InfraSteward does not pass that value manually and lets the remote server resolve it.

## MCP Integration

The `mcp-server/` package can expose selected InfraSteward scripts as MCP tools. Turn on the local MCP bridge with the **MCP On/Off** button in the main toolbar, then point your MCP client at `npm.cmd run mcp:dev` from this repository. The desktop app listens on `127.0.0.1:47321`; the stdio wrapper forwards MCP tool discovery and execution to that bridge. This is intentionally opt-in because MCP tool calls can execute remote commands over SSH.

Only enable **Use in MCP** for scripts you trust.

MCP calls accept an optional `timeoutSeconds` argument. The desktop app defaults it to `30` seconds and caps it at `60` seconds, so follow-mode scripts can be used without trapping the client forever.

## Project Structure

```text
src/            React frontend and shared TypeScript logic
src-tauri/      Tauri Rust backend, SSH execution, and native app config
mcp-server/     MCP stdio wrapper for the desktop bridge
docs/           Architecture, security, storage, and usage notes
dist/           Generated frontend build output
```

## Useful Commands

```bash
npm.cmd run lint
npm.cmd run test
npm.cmd run web:build
npm.cmd run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Security Notes

InfraSteward can execute commands on remote servers. Treat configured scripts as privileged automation:

- prefer least-privileged SSH users;
- review scripts before attaching or enabling them for MCP;
- avoid storing private keys in plaintext;
- keep local app data and fallback secret files protected;
- use key-based authentication where possible.

## Documentation

Additional notes live in `docs/`:

- `docs/user-guide.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/storage-format.md`
- `docs/ssh-execution.md`
- `docs/mcp-integration.md`
