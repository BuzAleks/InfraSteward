# User Guide

Start the app with `npm.cmd run dev` after installing Node dependencies and the Rust toolchain. Build the Windows installer with `npm.cmd run build`.

Use the top tab bar to create, switch, rename, and close workspaces. The pinned `LOCAL` workspace is always present and cannot be renamed or closed. New SSH workspaces start as `New Workspace`; after saving a connection, the connection name becomes the workspace title and tab label. Connection names must be unique because MCP tool names are derived from them.

The working data directory is shown in the main toolbar. Click the path to open it in the system file explorer. This directory contains `app-data.json`, optional insecure fallback secrets, and `logs/infrasteward.log`.

Open `Runner Settings` on `LOCAL` to choose the local shell runner. Open `Connection Settings` on SSH workspaces to configure host, port, username, authentication type, working directory, timeouts, and credentials. Use `Test Connection` before running SSH scripts. The SSH working directory is a remote path; scripts start there through `cd '<path>' && bash -s`.

Open `Script Manager` to create, edit, search, and delete global scripts. Deleting a script leaves existing tab attachments as missing references so the workspace can recover if a script is recreated.

Global scripts are stored as `.sh` files in the `scripts` folder inside the working data directory. The file name is tied to the script name: `Deploy` is stored as `Deploy.sh`. When the app starts, it scans that folder, adds new `.sh` files, removes scripts whose files were deleted, and reloads changed file content. A `# [description]` comment block in the file is used as the script description and is hidden from the content editor.

Use `Add` below the script list to attach global scripts to the active tab. Press the plus button next to a script to attach it immediately. The first copy of a script uses tag `default`; additional copies ask for a tag. Tags must be unique for that script within the workspace, and each tagged attachment has independent MCP settings. Select rows and use `MCP` to enable or disable MCP access for the selected attachments, or use `Remove` to detach them from the current tab only.

Use `Workspace Parameters` to configure detected `${VAR}` parameters for the current workspace. Parameters are collected from all attached scripts without duplicates and are removed when no attached script uses them. Enable `Local ENV` when the local app process should read the variable from its own environment, show it in the disabled Value field, and pass it to the target shell. Leave a manual value empty when the target shell should resolve the variable itself.

Open a script row's settings to edit its tag, add an attachment-specific description, and override parameters for that specific attachment. `WORKSPACE ENV` is enabled by default for each parameter; disable it to enter a script-specific value. Enable MCP access only for scripts you trust. MCP tool descriptions include the attachment-specific description when it is set.

Drag script rows by the handle on the left to change their order within the workspace. Use the run button on a row to execute one script on the active tab's target: the local machine for `LOCAL`, or the configured SSH server for SSH workspaces. While a script runs, other main-window script start buttons and reordering are blocked. Use the stop button to request cancellation.

Use the bottom Play button to run checked scripts sequentially in the current list order. If you stop the active script, the remaining queued scripts are cleared.

Use the new-window run button to open an independent log window for a script. The script does not start until you press Start in that window, and separate log windows can run in parallel.

Logs show lifecycle messages, stdout, stderr, status, timestamps, and exit code. Use Autoscroll to control whether logs follow new output. Use level filters to show or hide `info`, `warn`, `error`, `stdout`, and `stderr`. Copying selected log text, or pressing Copy, copies the log message text without timestamp and level metadata. Use Clear to clear the current tab or log window.

Use the **MCP** button on the right side of the tab bar to start or stop the local MCP bridge. MCP clients should run `npm.cmd run mcp:dev` from this repository and call only scripts where MCP access is enabled.

Local runners:

- Linux defaults to `bash -s`.
- macOS defaults to `zsh -s`.
- Windows defaults to Git Bash and auto-detects common `bash.exe` install paths.
- WSL uses `wsl.exe -- bash -s`.
- Custom runner executes the configured command and arguments, with the script written to stdin.
