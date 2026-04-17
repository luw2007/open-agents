---
name: harness-init
description: Initialize the Open Harness development system in the current repository. Creates .harness directory with task management, spec system, and workflow documentation.
---

# Initialize Open Harness

Initialize the Open Harness development system in the current repository.

## What It Creates

```
.harness/
├── .current-task          # Pointer to current task
├── config.yaml            # Project configuration
├── workflow.md            # Development workflow guide
├── tasks/                 # Task directories
├── spec/                  # Development guidelines
│   ├── backend/
│   ├── frontend/
│   └── guides/
└── workspace/             # Developer workspaces
```

## Usage

Run this skill to set up the harness system. Then:

1. Read `.harness/workflow.md` to understand the workflow
2. Customize `.harness/config.yaml` for your project
3. Add guidelines to `.harness/spec/`

## Multi-Agent Pipeline

Once initialized, you can use the dispatch subagent to orchestrate tasks:

- **dispatch** → coordinates research → implement → check phases
- **explorer** → read-only codebase exploration
- **executor** → implementation work
- **check** → code review and fixes
- **debug** → diagnose and fix issues

## Task Workflow

1. Create task directory in `.harness/tasks/MM-DD-name/`
2. Write PRD in `prd.md`
3. Configure context in `implement.jsonl` and `check.jsonl`
4. Use dispatch subagent to execute phases
5. Review and complete
