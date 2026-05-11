# Storage Format

InfraSteward stores non-secret settings in `app-data.json` under the configured working data directory.

Default locations, when no override is configured:

- Windows: `%APPDATA%/dev.infrasteward.desktop/app-data.json`
- macOS: `~/Library/Application Support/dev.infrasteward.desktop/app-data.json`
- Linux: `$XDG_DATA_HOME/dev.infrasteward.desktop/app-data.json` or `~/.local/share/dev.infrasteward.desktop/app-data.json`

The root object contains `schemaVersion`, `activeTabId`, `globalScripts`, and `workspaces`.

Secrets are stored as references such as `conn_x:password`, `conn_x:private-key`, and `conn_x:passphrase`. Secret values are kept in secure OS storage where available. If insecure fallback is explicitly allowed, values are stored in `insecure-secrets.json` in the same working data directory.

Logs are persisted with workspaces and capped at 500 entries per workspace.

Internal system logs are written as JSON lines to `logs/infrasteward.log` inside the working data directory. The system log is rotated by truncating older content when it grows beyond the configured size cap.

Working data directory resolution order is:

1. `INFRASTEWARD_DATA_DIR`
2. Windows registry value `HKCU\Software\InfraSteward\WorkingDataDir`
3. `data-dir.txt` in the app config directory
4. the platform default app data directory

The Windows NSIS installer prompts for the working data directory and stores the choice in the registry value above.

Future migrations should read older `schemaVersion` values, transform them, and write the current version atomically. Backup and restore can be done by copying `app-data.json` plus any required keychain entries or explicitly accepted insecure secret file.
