# User Guide

Start the app with `npm.cmd run dev` after installing Node dependencies and the Rust toolchain. Build the Windows installer with `npm.cmd run build`.

Use the top tab bar to create, switch, rename, and close workspaces. New workspaces start as `New Workspace`; after saving a connection, the connection name becomes the workspace title and tab label. Connection names must be unique because MCP tool names are derived from them.

The working data directory is shown in the main toolbar. Click the path to open it in the system file explorer. This directory contains `app-data.json`, optional insecure fallback secrets, and `logs/infrasteward.log`.

Open `Connection Settings` to configure host, port, username, authentication type, timeouts, and credentials. Use `Test Connection` before running scripts.

Open `Script Manager` to create, edit, search, and delete global scripts. Deleting a script leaves existing tab attachments as missing references so the workspace can recover if a script is recreated.

Use `Add` below the script list to attach global scripts to the active tab. Select rows and use `Remove` to detach them from the current tab only.

Open a script row's settings to configure detected `${VAR}` parameters. Enable `Use from environment` when the remote server should resolve the variable itself. Enable `Use in MCP` only for scripts you trust.

Use the run button to execute a script on the active tab's SSH server. While a script runs, other main-window script start buttons are blocked. Use the stop button to request cancellation.

Use the new-window run button to open an independent log window for a script. The script does not start until you press Start in that window, and separate log windows can run in parallel.

Logs show lifecycle messages, stdout, stderr, status, timestamps, and exit code. Use Autoscroll to control whether logs follow new output. Use level filters to show or hide `info`, `warn`, `error`, `stdout`, and `stderr`. Copying selected log text, or pressing Copy, copies the log message text without timestamp and level metadata. Use Clear to clear the current tab or log window.

Use **MCP On/Off** in the main toolbar to start or stop the local MCP bridge. MCP clients should run `npm.cmd run mcp:dev` from this repository and call only scripts where `Use in MCP` is enabled.
