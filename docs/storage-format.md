# Storage Format

InfraSteward stores non-secret settings in `app-data.json` under the standard per-user application data directory.

Expected locations:

- Windows: `%APPDATA%/dev.infrasteward.desktop/app-data.json`
- macOS: `~/Library/Application Support/dev.infrasteward.desktop/app-data.json`
- Linux: `$XDG_DATA_HOME/dev.infrasteward.desktop/app-data.json` or `~/.local/share/dev.infrasteward.desktop/app-data.json`

The root object contains `schemaVersion`, `activeTabId`, `globalScripts`, and `workspaces`.

Secrets are stored as references such as `conn_x:password`, `conn_x:private-key`, and `conn_x:passphrase`. Secret values are kept in the OS keychain where available. If insecure fallback is explicitly allowed, values are stored in `insecure-secrets.json` in the same app data directory.

Logs are persisted with workspaces and capped at 500 entries per workspace.

Future migrations should read older `schemaVersion` values, transform them, and write the current version atomically. Backup and restore can be done by copying `app-data.json` plus any required keychain entries or explicitly accepted insecure secret file.
