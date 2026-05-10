import type { SshConnectionConfig } from "./types";

export function validateConnection(connection: SshConnectionConfig, hasSavedSecret = false): string[] {
  const errors: string[] = [];

  if (!connection.host.trim()) {
    errors.push("Host is required.");
  }
  if (!connection.username.trim()) {
    errors.push("Username is required.");
  }
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
    errors.push("Port must be an integer from 1 to 65535.");
  }
  if (connection.authType === "password" && !connection.passwordRef && !hasSavedSecret) {
    errors.push("Password is required for password authentication.");
  }
  if (
    connection.authType === "privateKey" &&
    !connection.privateKeyPath &&
    !connection.privateKeyContentRef &&
    !hasSavedSecret
  ) {
    errors.push("Private key path or private key content is required for private key authentication.");
  }

  return errors;
}
