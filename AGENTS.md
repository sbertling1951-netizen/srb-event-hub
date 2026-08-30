# EpicentraX Agent Instructions

These instructions apply to every AI agent working in this repository.

## Mandatory first step

Before planning, editing, reviewing, or running a migration:

1. Read `docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md`.
2. Read the project Constitution and architecture rules/principles identified in that brief.
3. Inspect the current repository state and the files directly related to the task.
4. State any conflict between the requested work and the authoritative architecture before changing code.

Do not begin implementation until these steps are complete.

## Re-anchor and report

"Re-anchor and report" is a **read-only** startup operation. It orients a fresh
or reset agent and changes nothing.

### Authoritative checkout

Before reading any project state, verify the current directory is the
authoritative EpicentraX Git checkout:

- The authoritative checkout on this development Mac is
  `/Users/sbertling/Developer/srb-event-hub`.
- A valid checkout must be a Git repository and contain both `AGENTS.md` and
  `docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md`.
- If the current workspace does not satisfy those checks, switch inspection to
  `/Users/sbertling/Developer/srb-event-hub` before continuing.
- Do not select sibling backup, broken, scratch, transient worktree, or other
  plausible copies by inference.
- Do not use agent or conversation memory to choose an alternate source tree.
- If the authoritative path is unavailable or fails validation, report that and
  stop. Do not guess.

This check is itself read-only; re-anchor remains completely read-only.

When asked to re-anchor:

1. Inspect Git (`git status`, `git log`, current branch, HEAD, `origin/main`,
   ahead/behind), `AGENTS.md`, the Project Brief — including its Development
   checkpoint subsection and the Librarian-generated block — and the
   authoritative sources relevant to any work in progress.
2. Report: literal current HEAD and branch, the substantive development
   baseline, `origin/main` and ahead/behind, any pending promotion or
   production migration-ledger gate, and the next safe step.
3. Report every discrepancy found — including a Development checkpoint
   subsection or Librarian block that is stale relative to Git.

Re-anchoring must not modify, reconcile, regenerate, commit, push, or perform
any database write, and does not run `npm run context:update`. If the
hand-maintained checkpoint looks stale, state that plainly; repair it only when
separately instructed.

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
- confirmation that no unrelated files were changed;
- when the work landed a substantive product change that moves the development baseline (a feature, a migration, a fix), promoted the baseline to main, deployed to production, or changed the production migration ledger: confirmation that the Development checkpoint subsection in `docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md` was reconciled to the new baseline and `npm run context:update` was run before closeout. Continuity or governance-only commits — including edits to the checkpoint subsection itself — do not move the baseline and do not trigger this.
