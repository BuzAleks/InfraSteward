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
    expect(extractScriptVariables('df -h "${TARGET_PATH:-/}"')).toEqual(["TARGET_PATH"]);
  });

  it("ignores duplicates", () => {
    expect(extractScriptVariables("${APP_DIR} ${APP_DIR} ${BRANCH}")).toEqual(["APP_DIR", "BRANCH"]);
  });

  it("ignores escaped variables", () => {
    expect(extractScriptVariables("\\${LITERAL} ${REAL}")).toEqual(["REAL"]);
  });
});
