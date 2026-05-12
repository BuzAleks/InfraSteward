# InfraSteward

InfraSteward is a desktop DevOps assistant for managing local and SSH workspaces and running reusable shell scripts. It gives you a focused place to save server connection profiles, attach automation scripts to each workspace, configure script parameters, and inspect execution logs without turning everyday infrastructure work into a pile of one-off terminal commands.

Built with **Tauri 2**, **React**, **TypeScript**, and **Rust**, InfraSteward keeps the interface lightweight while using a native backend for SSH execution and local storage.

## Highlights

- **Tabbed local and SSH workspaces** for different machines, servers, environments, or projects.
- **Pinned LOCAL workspace** for running scripts on the machine where InfraSteward is open.
- **Password and private-key authentication** through the Rust `ssh2` backend.
- **Secret-aware credential storage** using the OS keychain when available, with an explicit local fallback option.
- **Reusable global `.sh` scripts** stored in the working data directory and attachable to any workspace multiple times.
- **Parameter detection** for `${VAR}` style script inputs.
- **Per-workspace script tags and settings** so the same global script can behave differently on the same or different servers.
- **Ordered and queued script runs** with selectable sequential execution.
- **Execution logs** with status, stdout, stderr, timestamps, level filters, copy support, and exit codes.
- **Local MCP bridge support** for exposing trusted scripts as LLM-callable tools.

## Screens

InfraSteward is organized around a small set of practical views:

- **Workspace tabs**: create, rename, switch, and close server workspaces; the pinned `LOCAL` tab cannot be removed.
- **Connection Settings / Runner Settings**: configure SSH credentials for remote workspaces or the local shell runner for `LOCAL`.
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

1. Use the pinned **LOCAL** workspace to run scripts on this machine, or open **Connection Settings** on an SSH workspace and enter the server host, port, username, and authentication method.
2. Enter a password or private key details, then click **Test Connection**.
3. Open **Script Manager** and create reusable shell scripts.
4. Attach scripts to the active workspace. The first copy uses tag `default`; additional copies ask for a unique tag.
5. Configure detected parameters and attachment tags in each script row's settings.
6. Click a row's **Run** button for a single script, or select several rows and click bottom **Play** to run them sequentially.
7. Review stdout, stderr, status, and exit code in the logs panel.

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

InfraSteward detects `${VAR}` and `${VAR:-default}` style variables in scripts. Bare `$VAR` references are ignored to avoid over-detecting internal shell variables. Workspace parameters are collected from attached scripts without duplicates and are removed when no attached script uses them. Manual values and selected local environment values are passed to the shell as environment variables instead of being substituted directly into script text.

Example:

```bash
TARGET_PATH='/var/log' bash -s <<'INFRAS_EOF'
df -h "${TARGET_PATH:-/}"
INFRAS_EOF
```

If **Local ENV** is enabled for a parameter, InfraSteward reads the variable from the local app process environment, shows that value in the disabled Value field, and passes it to the shell. Empty manual values are still omitted, so the target shell can resolve them itself.

For SSH workspaces, **Working directory** in Connection Settings is the directory on the remote server where scripts should start. InfraSteward applies it as `cd '<directory>' && bash -s`, so relative paths and commands such as `docker compose` behave as if the script began with `cd /your/project`.

## Local Execution

The pinned `LOCAL` workspace runs scripts on the machine where InfraSteward is open. Use **Runner Settings** to choose `bash`, `sh`, `zsh`, Git Bash, WSL bash, or a custom command. Linux defaults to `bash`, macOS defaults to `zsh`, and Windows defaults to Git Bash with auto-detection of common install paths. Output, cancellation, timeouts, parameters, queued runs, new log windows, and MCP all use the same workflow as SSH workspaces.

## MCP Integration

The `mcp-server/` package can expose selected InfraSteward scripts as MCP tools. Turn on the local MCP bridge with the **MCP** button on the right side of the tab bar, then point your MCP client at `npm.cmd run mcp:dev` from this repository. The desktop app listens on `127.0.0.1:47321`; the stdio wrapper forwards MCP tool discovery and execution to that bridge. This is intentionally opt-in because MCP tool calls can execute commands on SSH targets or on the local machine.

Only enable MCP access for scripts you trust.

Tool names include connection name, script name, and attachment tag. For example, `REG.RU` + `LOGS` + `default` becomes `reg_ru_logs_default`.

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
