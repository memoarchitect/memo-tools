# MEMO Tools: work with a model from the command line

MEMO Tools is the automation layer for a MEMO project. It reads your SysML v2
source and gives you the `memo` command to create a project, validate it,
exchange information with other tools, and produce review artifacts. Your
`.sysml` files remain the source of truth.

MEMO Tools does not define the medical-device vocabulary—that belongs to the
[MEMO Ontology documentation](https://memoarchitect.com/memo/) and its
[GitHub repository](https://github.com/memoarchitect/memo)—and it is not the visual
review application—that is [MEMO Architect documentation](https://memoarchitect.com/memo-architect/)
and its [GitHub repository](https://github.com/memoarchitect/memo-architect).

!!! warning "Experimental before 1.0"
    MEMO Tools and the ontology APIs may change before version 1.0. Use a
    [tagged release](https://github.com/memoarchitect/memo-tools/releases) and
    an exact npm version rather than `main` or a floating range for reproducible work.

[MEMO Tools GitHub repository](https://github.com/memoarchitect/memo-tools) ·
[MEMO product website](https://memoarchitect.com/)

Start with a task:

| Goal | Go to |
|---|---|
| Check what must be installed | [Prerequisites](start/prerequisites.md) |
| Create a device-model project | [Install and Create a Project](start/install.md) |
| See value in a few minutes | [First Useful Workflow](start/first-workflow.md) |
| Find missing traceability | [Validate a Model](tasks/validate.md) |
| Bring in spreadsheet records | [Import Existing Data](tasks/import.md) |
| Generate JSON, DOT, DHF, or a package | [Export and Share](tasks/export.md) |
| Enforce model quality in a pipeline | [Run in CI](tasks/ci.md) |
| Find a command | [Command Map](reference/commands.md) |

## A useful first loop

Create a project, add one small connected slice, and validate it before adding
more. That loop is the centre of this site:

```bash
npx memo init my-device
cd my-device
npx memo validate .
```

After that, choose a task above—importing existing records, exporting an
artifact, or adding validation to CI. You can use Tools without Architect.
