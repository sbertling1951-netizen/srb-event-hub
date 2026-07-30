# EpicentraX Agent Instructions

These instructions apply to every AI agent working in this repository.

## Mandatory first step

Before planning, editing, reviewing, or running a migration:

1. Read `docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md`.
2. Read the project Constitution and architecture rules/principles identified in that brief.
3. Inspect the current repository state and the files directly related to the task.
4. State any conflict between the requested work and the authoritative architecture before changing code.

Do not begin implementation until these steps are complete.

## Working rules

- Prefer the simplest, cleanest solution that satisfies the stated requirement.
- Do not add abstractions, scaffolding, dependencies, fallback systems, duplicate state, or unrelated improvements.
- Preserve one authoritative source of truth for every important datum.
- Treat database evidence and observable runtime output as proof. Code intent alone is not proof that a workflow works.
- Make narrow changes. Avoid collisions and unintended consequences.
- Never modify unrelated files.
- Never weaken authentication, authorization, RLS, auditability, or tenant isolation to make a feature work.
- Do not invent identity evidence or use ambiguous identifiers as conclusive proof.
- Do not commit, push, deploy, reset a database, or run destructive commands unless the task explicitly authorizes it.
- Stop when a required fact cannot be verified safely.

## Completion standard

Report:

- files changed;
- exact behavior changed;
- validation commands and results;
- database or runtime evidence when the task concerns stored data or operational behavior;
- remaining risks or unverified assumptions;
- confirmation that no unrelated files were changed.
