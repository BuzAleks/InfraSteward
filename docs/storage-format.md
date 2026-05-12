# Storage Format

InfraSteward stores non-secret workspace settings in `app-data.json` under the configured working data directory. Global script bodies are stored as `.sh` files in the `scripts` subdirectory of the same working data directory.

Default locations, when no override is configured:

- Windows: `%APPDATA%/dev.infrasteward.desktop/app-data.json`
- macOS: `~/Library/Application Support/dev.infrasteward.desktop/app-data.json`
- Linux: `$XDG_DATA_HOME/dev.infrasteward.desktop/app-data.json` or `~/.local/share/dev.infrasteward.desktop/app-data.json`

The root object contains `schemaVersion`, `activeTabId`, `globalScripts`, and `workspaces`. `globalScripts` keeps script identity metadata and `fileName` references only; script bodies and descriptions are loaded from `.sh` files at runtime and are not duplicated in `app-data.json`.

Each global script maps to `scripts/<script name>.sh`. Creating or editing a script in the app writes that file. Renaming a script renames the file. Deleting a script in the app deletes the file. On startup, new `.sh` files are added as global scripts, removed `.sh` files remove matching global scripts, and changed file contents update the script content and description.

Script descriptions are stored in a comment block. The app reads the block from anywhere in the file, strips the leading `#`, hides the block from the content editor, and writes it back near the top of the file after an optional shebang:

```sh
#!/usr/bin/env bash
# [description]
# This script makes everyone happy
# Don't use it too frequently
# [/description]
```

Each workspace stores `parameterSettings` and `attachedScripts`. Workspace `parameterSettings` is synchronized from attached script variables: parameters are added without duplicates and removed when no attached script uses them. An attachment references a global script by `globalScriptId`, has its own unique-per-script `tag` and attachment-level `description` inside that workspace, and owns independent `parameterSettings` overrides and `useInMcp` values. Attachment parameters use the workspace value by default unless `useWorkspaceValue` is set to `false`.

Secrets are stored as references such as `conn_x:password`, `conn_x:private-key`, and `conn_x:passphrase`. Secret values are kept in secure OS storage where available. If insecure fallback is explicitly allowed, values are stored in `insecure-secrets.json` in the same working data directory.

Logs are persisted with workspaces and capped at 500 entries per workspace.

Internal system logs are written as JSON lines to `logs/infrasteward.log` inside the working data directory. The system log is rotated by truncating older content when it grows beyond the configured size cap.

Working data directory resolution order is:

1. `INFRASTEWARD_DATA_DIR`
2. Windows registry value `HKCU\Software\InfraSteward\WorkingDataDir`
3. `data-dir.txt` in the app config directory
4. the platform default app data directory

The Windows NSIS installer prompts for the working data directory and stores the choice in the registry value above.

Backup and restore can be done by copying `app-data.json`, the `scripts` directory, and any required keychain entries or explicitly accepted insecure secret file.
