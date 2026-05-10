# Security

InfraSteward can store SSH credentials and execute commands on remote servers. Treat every configured script as privileged automation.

Passwords, private key contents, and passphrases are stored through an abstraction that uses the OS keychain first. Insecure fallback storage requires explicit user opt-in and is documented as plaintext-risk local storage.

Use key-based authentication where possible. Avoid root SSH users. Prefer a least-privileged deployment user with only the permissions needed for the selected scripts.

Review scripts before running them and before enabling MCP. MCP tool calls can be initiated by an LLM client, so destructive scripts should usually remain disabled for MCP.

The MCP server uses stdio and should remain local. Do not bind it to a public interface.

Host key verification is limited in the current implementation. For production use, add known-host validation and clear UI for trust decisions.

Protect local app data files, SSH key files, and OS account access. Do not commit local config, logs, secrets, private keys, or generated artifacts.
