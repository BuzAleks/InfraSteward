# Security

InfraSteward can store SSH credentials and execute commands on remote servers. Treat every configured script as privileged automation.

Passwords, private key contents, and passphrases are stored through an abstraction that uses secure OS storage first. On Windows this is Windows Credential Manager; on other platforms it is the OS keychain through the `keyring` crate. Insecure fallback storage requires explicit user opt-in and is documented as plaintext-risk local storage.

Use key-based authentication where possible. Avoid root SSH users. Prefer a least-privileged deployment user with only the permissions needed for the selected scripts.

Review scripts before running them and before enabling MCP. MCP tool calls can be initiated by an LLM client, so destructive scripts should usually remain disabled for MCP.

MCP uses a local stdio wrapper plus a desktop-app bridge bound to `127.0.0.1:47321`. Keep both local. Do not expose the bridge on a public interface.

Host key verification is limited in the current implementation. For production use, add known-host validation and clear UI for trust decisions.

Protect local app data files, system logs, SSH key files, and OS account access. Do not commit local config, logs, secrets, private keys, or generated artifacts.
