import { describe, expect, it } from "vitest";
import { extractScriptVariables } from "./parser";

describe("extractScriptVariables", () => {
  it("extracts shell variables in first-seen order", () => {
    expect(extractScriptVariables('cd "${APP_DIR}" && echo "${SERVICE_NAME}"')).toEqual([
      "APP_DIR",
      "SERVICE_NAME"
    ]);
  });

  it("extracts a variable from default expressions", () => {
    expect(extractScriptVariables('df -h "${TARGET_PATH:-/}" && echo "${SERVICE_NAME:-DEF_SERVICE}"')).toEqual([
      "TARGET_PATH",
      "SERVICE_NAME"
    ]);
  });

  it("ignores duplicates", () => {
    expect(extractScriptVariables("${APP_DIR} ${APP_DIR} ${BRANCH}")).toEqual(["APP_DIR", "BRANCH"]);
  });

  it("ignores bare shell variables", () => {
    expect(extractScriptVariables("$APP_DIR ${BRANCH}")).toEqual(["BRANCH"]);
  });

  it("ignores escaped variables", () => {
    expect(extractScriptVariables("\\${LITERAL} ${REAL}")).toEqual(["REAL"]);
  });
});
