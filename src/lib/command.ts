import type { PreparedCommand, ScriptParameterSetting } from "./types";

export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function prepareRemoteCommand(
  scriptContent: string,
  parameterSettings: Record<string, ScriptParameterSetting>,
  shell: "bash" | "sh" = "bash",
  localEnvironment: Record<string, string | undefined> = {},
  workingDirectory = ""
): PreparedCommand {
  const environment: Record<string, string> = {};

  for (const [name, setting] of Object.entries(parameterSettings)) {
    if (setting.useFromEnvironment) {
      const localValue = localEnvironment[name];
      if (localValue !== undefined) {
        environment[name] = localValue;
      }
      continue;
    }
    if (setting.value === "") {
      continue;
    }
    environment[name] = setting.value;
  }

  const envPrefix = Object.entries(environment)
    .map(([name, value]) => `${name}=${shellSingleQuote(value)}`)
    .join(" ");

  const commandShell = shell === "bash" ? "bash -s" : "sh -s";
  const cdPrefix = workingDirectory.trim() ? `cd ${shellSingleQuote(workingDirectory.trim())} && ` : "";
  const command = `${cdPrefix}${envPrefix ? `${envPrefix} ` : ""}${commandShell} <<'INFRAS_EOF'\n${scriptContent}\nINFRAS_EOF`;

  return { command, environment };
}
