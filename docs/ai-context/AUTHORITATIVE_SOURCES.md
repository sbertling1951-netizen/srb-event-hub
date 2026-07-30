# EpicentraX Authoritative Source Index

This file identifies the authoritative sources every human or AI contributor must read before planning, editing, reviewing, or validating EpicentraX work.

Do not duplicate these documents into another context system. Reference and update the original source.

## Foundational authority

| Domain | Authoritative source |
|---|---|
| EpicentraX Constitution | `docs/architecture/ADR-000 EpicentraX Constitution.md` |
| Architecture decisions and principles | `docs/architecture/` |
| Admin Workspace architecture | `docs/architecture/ADR-002 Admin Workspace Architecture.md` |
| Participant identity model | `docs/architecture/ADR-003 Participant Identity Model.md` |
| Tenant identity framework | `docs/architecture/ADR-004 Tenant Identity Framework.md` |
| Identity, authentication, and authorization | `docs/architecture/ADR-005 Identity Authentication Authorization.md` |
| Event context architecture | `docs/architecture/ADR-006 Event Context Architecture.md` |
| Tenant branding and white-label architecture | `docs/architecture/ADR-009 Tenant Branding and White Label Architecture.md` |
| AI trust and learning architecture | `docs/architecture/ADR-010 AI Trust and Learning Architecture.md` |
| Participant identity UX principles | `docs/EpicentraX_UX_Participant_Identity_Principles.docx` |

## Identity implementation and evidence

| Domain | Authoritative source |
|---|---|
| Identity foundation schema | `supabase/migrations/20260724_create_person_identity_foundation.sql` |
| Automatic identity attribution manifest | `supabase/identity-audits/20260726_person_identity_automatic_backfill_manifest.sql` |
| Identity reconciliation audit | `supabase/identity-audits/20260724_person_identity_reconciliation_audit.sql` |
| Stage 4 clustering strategy | `supabase/identity-audits/baseline-diagnostics/stage4_identity_clustering_strategy.md` |
| Stage 5B resolution manifest | `supabase/identity-audits/baseline-diagnostics/stage5b_identity_resolution_manifest.md` |
| Stage 6 link application | `supabase/identity-audits/baseline-diagnostics/stage6_identity_link_application.md` |
| Stage 7 integrity verification | `supabase/identity-audits/baseline-diagnostics/stage7_identity_integrity_verification.md` |
| Stage 8A claim foundation | `supabase/identity-audits/baseline-diagnostics/stage8a_identity_claim_foundation.md` |
| Tenant identity recommendation | `supabase/identity-audits/baseline-diagnostics/tenant_identity_architecture_recommendation.md` |

## Operational authority

| Domain | Authoritative source |
|---|---|
| Agent development rules | `AGENTS.md` |
| Claude/LEM entry instructions | `CLAUDE.md` |
| VS Code/Copilot entry instructions | `.github/copilot-instructions.md` |
| Shared current project summary | `docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md` |
| Current application dependencies | `package.json` |
| Current database schema changes | `supabase/migrations/` |
| Current application behavior | `app/`, `components/`, and `lib/` |
| Current persisted data | The applicable verified database environment |
| Current deployment behavior | Verified live runtime and infrastructure evidence |

## Authority order

When sources appear to disagree, apply this order:

1. EpicentraX Constitution.
2. Applicable accepted Architecture Decision Records.
3. Task-specific authoritative architecture or identity documents.
4. Applied database migrations and verified database structure.
5. Verified persisted data and runtime evidence.
6. Current application source code.
7. The shared project brief and agent summaries.

A summary, briefing, AI response, comment, or source-code intention is never stronger evidence than the authoritative source or verified outcome it describes.

## Mandatory reading rule

Before beginning a task, every contributor must:

1. Read the Constitution.
2. Read the ADRs relevant to the task.
3. Read the applicable identity, migration, security, or audit records.
4. Inspect the actual files and current repository state.
5. Verify current database or runtime facts when the answer depends on them.

Do not rely solely on cached AI context, prior conversations, filenames, source-code intent, or historical counts.
