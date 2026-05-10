import { describe, expect, it } from "vitest";
import { prepareRemoteCommand, shellSingleQuote } from "./command";

describe("shellSingleQuote", () => {
  it("quotes values safely for POSIX shells", () => {
    expect(shellSingleQuote("it's ok")).toBe("'it'\"'\"'s ok'");
  });
});

describe("prepareRemoteCommand", () => {
  it("passes only manual non-empty values as environment variables", () => {
    const prepared = prepareRemoteCommand("echo ${APP_DIR} ${REMOTE_ONLY}", {
      APP_DIR: { value: "/srv/app", useFromEnvironment: false },
      REMOTE_ONLY: { value: "ignored", useFromEnvironment: true },
      EMPTY: { value: "", useFromEnvironment: false }
    });

    expect(prepared.environment).toEqual({ APP_DIR: "/srv/app" });
    expect(prepared.command).toContain("APP_DIR='/srv/app' bash -s <<'INFRAS_EOF'");
    expect(prepared.command).toContain("echo ${APP_DIR} ${REMOTE_ONLY}");
  });
});
