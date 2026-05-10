# SSH Execution

InfraSteward connects with the Rust `ssh2` crate. Password and private-key authentication are supported. Private key authentication can use a file path or saved private key content.

Secrets are resolved from the OS credential store through the `SecretStore` abstraction. Plaintext secrets are not stored in `app-data.json`.

Script parameters are not substituted into script text. Manual non-empty values are passed as environment variables:

```bash
VAR1='value1' VAR2='value2' bash -s <<'INFRAS_EOF'
script content
INFRAS_EOF
```

Single quotes in values are escaped using the standard POSIX `'"'"'` pattern. If `Use from environment` is enabled, the variable is not passed manually. If a manual value is empty, it is not passed manually.

The first implementation reads stdout and stderr after command completion. The UI records stdout, stderr, status, and exit code. A future improvement should emit Tauri events for true live streaming and cancellation.

The remote target is assumed to have `bash`. Unix-like SSH targets are the intended MVP target. Host key verification is not yet strict and should be improved before high-risk use.
