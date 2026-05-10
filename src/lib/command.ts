import type { PreparedCommand, ScriptParameterSetting } from "./types";

export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function prepareRemoteCommand(
  scriptContent: string,
  parameterSettings: Record<string, ScriptParameterSetting>,
  shell: "bash" | "sh" = "bash"
): PreparedCommand {
  const environment: Record<string, string> = {};

  for (const [name, setting] of Object.entries(parameterSettings)) {
    if (setting.useFromEnvironment || setting.value === "") {
      continue;
    }
    environment[name] = setting.value;
  }

  const envPrefix = Object.entries(environment)
    .map(([name, value]) => `${name}=${shellSingleQuote(value)}`)
    .join(" ");

  const commandShell = shell === "bash" ? "bash -s" : "sh -s";
  const command = `${envPrefix ? `${envPrefix} ` : ""}${commandShell} <<'INFRAS_EOF'\n${scriptContent}\nINFRAS_EOF`;

  return { command, environment };
}
