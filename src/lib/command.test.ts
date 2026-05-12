import { describe, expect, it } from "vitest";
import { prepareRemoteCommand, shellSingleQuote } from "./command";

describe("shellSingleQuote", () => {
  it("quotes values safely for POSIX shells", () => {
    expect(shellSingleQuote("it's ok")).toBe("'it'\"'\"'s ok'");
  });
});

describe("prepareRemoteCommand", () => {
  it("passes manual and local environment values as remote environment variables", () => {
    const prepared = prepareRemoteCommand(
      "echo ${APP_DIR} ${LOCAL_TOKEN} ${REMOTE_ONLY}",
      {
        APP_DIR: { value: "/srv/app", useFromEnvironment: false },
        LOCAL_TOKEN: { value: "saved-manual-value", useFromEnvironment: true },
        REMOTE_ONLY: { value: "ignored", useFromEnvironment: true },
        EMPTY: { value: "", useFromEnvironment: false }
      },
      "bash",
      { LOCAL_TOKEN: "from-local-env" }
    );

    expect(prepared.environment).toEqual({ APP_DIR: "/srv/app", LOCAL_TOKEN: "from-local-env" });
    expect(prepared.command).toContain("APP_DIR='/srv/app' LOCAL_TOKEN='from-local-env' bash -s <<'INFRAS_EOF'");
    expect(prepared.command).toContain("echo ${APP_DIR} ${LOCAL_TOKEN} ${REMOTE_ONLY}");
  });
});
