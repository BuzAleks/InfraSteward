const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

export function extractScriptVariables(content: string): string[] {
  const variables: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "$" || content[index + 1] !== "{") {
      continue;
    }

    if (isEscaped(content, index)) {
      continue;
    }

    const expressionStart = index + 2;
    const expressionEnd = content.indexOf("}", expressionStart);
    if (expressionEnd === -1) {
      continue;
    }

    const expression = content.slice(expressionStart, expressionEnd);
    const match = expression.match(VARIABLE_NAME);
    if (!match) {
      index = expressionEnd;
      continue;
    }

    const variable = match[0];
    addVariable(variable, variables, seen);

    index = expressionEnd;
  }

  return variables;
}

function addVariable(variable: string, variables: string[], seen: Set<string>): void {
  if (!seen.has(variable)) {
    seen.add(variable);
    variables.push(variable);
  }
}

function isEscaped(content: string, dollarIndex: number): boolean {
  let slashCount = 0;
  for (let i = dollarIndex - 1; i >= 0 && content[i] === "\\"; i -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
