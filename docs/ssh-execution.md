# Script Execution

InfraSteward connects with the Rust `ssh2` crate. Password and private-key authentication are supported. Private key authentication can use a file path or saved private key content.

Secrets are resolved from the OS credential store through the `SecretStore` abstraction. Plaintext secrets are not stored in `app-data.json`.

Script parameters are not substituted into script text. Manual non-empty values and selected local environment values are passed as environment variables. SSH workspaces execute with `bash -s` remotely; the `LOCAL` workspace executes with the configured local runner. If an SSH working directory is configured, the command is prefixed with `cd '<directory>' &&`, so relative paths resolve from that remote directory.

```bash
VAR1='value1' VAR2='value2' bash -s <<'INFRAS_EOF'
script content
INFRAS_EOF
```

Single quotes in values are escaped using the standard POSIX `'"'"'` pattern. If `Local ENV` is enabled, the variable is read from the local app process environment and passed to the target shell. If a manual value is empty, it is not passed manually and the target shell can resolve it itself.

Stdout and stderr are streamed while the command runs. The UI records lifecycle events, output chunks, status, and exit code. Cancellation closes the SSH channel and marks the run as `cancelled`; execution timeout closes the channel and returns `timeout`.

Main-window execution blocks other main-window script starts while one script is running. Separate log windows can start independent executions in parallel.

The remote SSH target is assumed to have `bash`. Unix-like SSH targets are the intended MVP target. Host key verification is not yet strict and should be improved before high-risk use. Local Windows execution is intended for Git Bash or WSL when running `.sh` scripts.
