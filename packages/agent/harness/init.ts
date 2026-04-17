/**
 * Harness System Initialization
 * Creates the .harness directory structure in a repository
 */

import {
  createDefaultConfig,
  createDefaultGuidesIndex,
  createDefaultSpecIndex,
  createDefaultWorkflow,
} from "./task";

export interface InitOptions {
  layers?: string[];
  withGuides?: boolean;
}

/**
 * Get the list of files to create for initializing harness
 */
export function getInitFileList(options: InitOptions = {}): Array<{
  path: string;
  content: string;
}> {
  const { layers = ["backend", "frontend"], withGuides = true } = options;
  const files: Array<{ path: string; content: string }> = [];

  // Config file
  files.push({
    path: ".harness/config.yaml",
    content: `# Open Harness Configuration
# Project-level settings for the development workflow

# Session Recording
session_commit_message: "chore: record journal"
max_journal_lines: 2000

# Packages (for monorepo projects)
# packages:
#   web:
#     path: apps/web
#   api:
#     path: apps/api

# default_package: web

# Spec Scope - which packages to include in spec injection
# spec_scope: active_task  # or ["web", "api"]

# Task Lifecycle Hooks
hooks:
  after_create: []
  after_start: []
  after_finish: []
  after_archive: []

# Update Skip Paths
update:
  skip: []
`,
  });

  // Workflow documentation
  files.push({
    path: ".harness/workflow.md",
    content: createDefaultWorkflow(),
  });

  // Current task pointer
  files.push({
    path: ".harness/.current-task",
    content: "",
  });

  // Spec directories
  for (const layer of layers) {
    files.push({
      path: `.harness/spec/${layer}/index.md`,
      content: createDefaultSpecIndex(layer),
    });
  }

  // Guides directory
  if (withGuides) {
    files.push({
      path: ".harness/spec/guides/index.md",
      content: createDefaultGuidesIndex(),
    });
  }

  // Tasks directory (empty)
  files.push({
    path: ".harness/tasks/.gitkeep",
    content: "",
  });

  // Workspace directory (empty)
  files.push({
    path: ".harness/workspace/.gitkeep",
    content: "",
  });

  return files;
}

/**
 * Get shell commands to initialize harness
 */
export function getInitCommands(options: InitOptions = {}): string[] {
  const files = getInitFileList(options);
  const commands: string[] = [];

  commands.push("# Initialize Open Harness directory structure");
  commands.push("mkdir -p .harness/{tasks,workspace,spec}");

  for (const file of files) {
    // Escape content for shell
    const escapedContent = file.content
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "'\\''")
      .replace(/\$/g, "\\$");

    commands.push(`cat > '${file.path}' << 'HARNESSEOF'`);
    commands.push(file.content);
    commands.push("HARNESSEOF");
  }

  commands.push("");
  commands.push("# Harness initialized!");
  commands.push("# Next steps:");
  commands.push("# 1. Read .harness/workflow.md");
  commands.push("# 2. Customize .harness/config.yaml");
  commands.push("# 3. Add guidelines to .harness/spec/");

  return commands;
}

/**
 * Get a summary of the harness structure
 */
export function getHarnessStructure(): string {
  return `
Open Harness Directory Structure
================================

.harness/
├── .current-task          # Pointer to current task
├── config.yaml            # Project configuration
├── workflow.md            # Development workflow guide
├── tasks/                 # Task directories
│   └── MM-DD-name/
│       ├── task.json      # Task configuration
│       ├── prd.md         # Requirements
│       ├── implement.jsonl # Implement context
│       └── check.jsonl    # Check context
├── spec/                  # Development guidelines
│   ├── backend/
│   │   └── index.md       # Backend guidelines
│   ├── frontend/
│   │   └── index.md       # Frontend guidelines
│   └── guides/
│       └── index.md       # Cross-cutting guides
└── workspace/             # Developer workspaces
    └── {developer}/
        ├── index.md
        └── journal-N.md

Key Concepts
============

1. Tasks: Each feature/bugfix gets a task directory with PRD and context
2. Specs: Project guidelines organized by layer (backend, frontend, etc.)
3. Multi-Agent Pipeline: dispatch → explorer → executor → check → debug
4. Context Injection: Relevant specs auto-injected based on task configuration
`;
}
