# User Guide

Start the app with `npm run dev` after installing Node dependencies and the Rust toolchain.

Use the top tab bar to create, switch, rename, and close workspaces. Double-click a tab to rename it. The active tab is saved and restored.

Open `Connection Settings` to configure host, port, username, authentication type, timeouts, and credentials. Use `Test Connection` before running scripts.

Open `Script Manager` to create, edit, search, and delete global scripts. Deleting a script leaves existing tab attachments as missing references so the workspace can recover if a script is recreated.

Use `Add` below the script list to attach global scripts to the active tab. Select rows and use `Remove` to detach them from the current tab only.

Open a script row's settings to configure detected `${VAR}` parameters. Enable `Use from environment` when the remote server should resolve the variable itself. Enable `Use in MCP` only for scripts you trust.

Use `Run` to execute a script on the active tab's SSH server. Logs show lifecycle messages, stdout, stderr, status, timestamps, and exit code. Use `Clear Logs` to clear the current tab.
