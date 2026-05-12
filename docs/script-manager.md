# Script Manager

Global scripts are reusable templates available to every workspace tab. Tabs attach references to global scripts and store per-attachment tags, parameter settings, and MCP enablement.

The same global script can be attached to a workspace more than once. The first attachment uses tag `default`; additional attachments ask for a tag. Tags are unique per global script within a workspace and are shown after the script name, such as `Deploy (blue)`.

Variables are detected from shell expressions like `${APP_DIR}` and `${SERVICE_NAME}`. `${VAR:-default}` is supported by detecting `VAR` while leaving the script text unchanged. Duplicate variables are shown once in first-seen order. Bare `$VAR` references are ignored to avoid over-detecting internal shell variables. Escaped variables such as `\${VAR}` are ignored.

Unsupported shell expansion cases may not be parsed perfectly, especially nested expansions or indirect expansion forms. The execution engine does not rewrite expansions, so shell behavior remains intact.

When a global script is edited, attached tabs keep referencing it and existing matching parameter settings remain available. Removed parameter settings may stay in storage but are not shown unless the variable returns.

When a global script is deleted, existing attachments become missing references and are shown as recoverable errors in the script list.
