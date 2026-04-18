/**
 * Task Management System for Open Harness
 * Inspired by Trellis task system
 */

import { z } from "zod";

// Task configuration schema
export const taskConfigSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  status: z.enum(["planning", "in_progress", "review", "completed", "archived"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  assignee: z.string().optional(),
  description: z.string().optional(),
  package: z.string().optional(),
  parent: z.string().optional(),
  children: z.array(z.string()).default([]),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  scope: z.string().optional(),
  prUrl: z.string().optional(),
  nextAction: z.array(z.enum(["research", "implement", "check", "debug", "finish", "create-pr"])),
  currentPhase: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TaskConfig = z.infer<typeof taskConfigSchema>;

// Context file entry schema (for implement.jsonl, check.jsonl, debug.jsonl)
export const contextEntrySchema = z.object({
  path: z.string(),
  reason: z.string(),
  addedAt: z.string(),
});

export type ContextEntry = z.infer<typeof contextEntrySchema>;

// Project configuration schema
export const harnessConfigSchema = z.object({
  sessionCommitMessage: z.string().default("chore: record journal"),
  maxJournalLines: z.number().default(2000),
  packages: z.record(z.string(), z.object({
    path: z.string(),
    type: z.enum(["package", "submodule"]).default("package"),
  })).optional(),
  defaultPackage: z.string().optional(),
  specScope: z.union([z.literal("active_task"), z.array(z.string())]).optional(),
  hooks: z.object({
    afterCreate: z.array(z.string()).default([]),
    afterStart: z.array(z.string()).default([]),
    afterFinish: z.array(z.string()).default([]),
    afterArchive: z.array(z.string()).default([]),
  }).default({
    afterCreate: [],
    afterStart: [],
    afterFinish: [],
    afterArchive: [],
  }),
  update: z.object({
    skip: z.array(z.string()).default([]),
  }).default({ skip: [] }),
});

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;

// Default task template
export function createDefaultTaskConfig(
  title: string,
  slug: string,
  options: Partial<TaskConfig> = {}
): TaskConfig {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${slug}`,
    title,
    slug,
    status: "planning",
    priority: "P2",
    nextAction: ["research", "implement", "check"],
    children: [],
    createdAt: now,
    updatedAt: now,
    ...options,
  };
}

// Default PRD template
export function createDefaultPrd(title: string): string {
  return `# ${title}

## Goal
<!-- What we're trying to achieve -->

## Requirements
<!-- List specific requirements -->
- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3

## Acceptance Criteria
<!-- Define what "done" looks like -->
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Technical Notes
<!-- Any technical decisions, constraints, or notes -->

## Related Files
<!-- Files that will likely need modification -->

## References
<!-- Links to specs, designs, or related tasks -->
`;
}

// Default spec index template
export function createDefaultSpecIndex(layer: string): string {
  return `# ${layer.charAt(0).toUpperCase() + layer.slice(1)} Development Guidelines

## Pre-Development Checklist

Before starting ${layer} development, read:

- [ ] This index file
- [ ] Relevant topic files listed below
- [ ] \`../guides/index.md\` for cross-cutting concerns

## Quality Check

Before marking work complete, verify:

- [ ] Code follows project conventions
- [ ] Type checks pass
- [ ] Lint checks pass
- [ ] Tests pass (if applicable)

## Topic Guidelines

<!-- Add links to specific guideline files as they are created -->

### Getting Started

1. Read the relevant topic files for your work
2. Follow the patterns established in existing code
3. Run validation commands before finishing

## Common Patterns

<!-- Document common patterns and examples -->
`;
}

// Default guides index template
export function createDefaultGuidesIndex(): string {
  return `# Cross-Cutting Development Guides

## Available Guides

<!-- Add links to cross-cutting guides as they are created -->

## Thinking Patterns

### Read Before Write
Always understand existing code and patterns before making changes.

### Follow Standards
Use established patterns rather than inventing new ones.

### Incremental Development
Complete one task at a time. Don't batch unrelated changes.

### Document Learnings
Update spec docs when you discover new patterns or fix bugs.

## Decision Records

<!-- Document architectural decisions and their rationale -->
`;
}

// Default workflow template
export function createDefaultWorkflow(): string {
  return `# Development Workflow

## Quick Start

### Step 1: Check Context
\`\`\`bash
# In sandbox shell
cat .harness/.current-task 2>/dev/null || echo "No active task"
\`\`\`

### Step 2: Read Guidelines
\`\`\`bash
# Read spec index for your layer
cat .harness/spec/backend/index.md
# or
cat .harness/spec/frontend/index.md

# Always read guides
cat .harness/spec/guides/index.md
\`\`\`

## Task Workflow

### Phase 1: Create Task
\`\`\`bash
# Create task directory with PRD
mkdir -p .harness/tasks/MM-DD-task-name
cat > .harness/tasks/MM-DD-task-name/task.json << 'EOF'
{
  "id": "...",
  "title": "Task Title",
  "slug": "task-name",
  "status": "planning",
  "priority": "P2",
  "nextAction": ["research", "implement", "check"],
  "children": [],
  "createdAt": "...",
  "updatedAt": "..."
}
EOF
\`\`\`

### Phase 2: Write PRD
Create \`.harness/tasks/MM-DD-task-name/prd.md\` with requirements.

### Phase 3: Research
Call explorer subagent to analyze codebase and find relevant specs.

### Phase 4: Configure Context
\`\`\`bash
# Initialize context files
echo '[]' > .harness/tasks/MM-DD-task-name/implement.jsonl
echo '[]' > .harness/tasks/MM-DD-task-name/check.jsonl

# Add context entries
# (Managed by system or agent)
\`\`\`

### Phase 5: Implement
Call executor subagent with context from implement.jsonl.

### Phase 6: Check
Call check subagent to review and fix issues.

### Phase 7: Complete
Update task status and archive if done.

## Best Practices

- Read spec files before coding
- Run validation commands after changes
- Record sessions after completing work
- Update specs when learning new patterns
`;
}

// Default config template
export function createDefaultConfig(): HarnessConfig {
  return {
    sessionCommitMessage: "chore: record journal",
    maxJournalLines: 2000,
    hooks: {
      afterCreate: [],
      afterStart: [],
      afterFinish: [],
      afterArchive: [],
    },
    update: {
      skip: [],
    },
  };
}
