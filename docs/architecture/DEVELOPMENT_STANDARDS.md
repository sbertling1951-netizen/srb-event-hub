# EpicentraX Development Standards

**Status:** Living architectural standard

**Date:** August 3, 2026

## Purpose

This document establishes the permanent engineering and documentation
standards for EpicentraX. It defines how architecture, implementation,
documentation, and review are performed so that all contributors—human and
AI—work from a consistent set of expectations.

These standards complement the EpicentraX Constitution and Architecture
Decision Records (ADRs). If a conflict exists, the Constitution takes
precedence, followed by accepted ADRs, then these Development Standards.

## Required Reading

Before planning, reviewing, or implementing changes, every contributor shall
read, at minimum:

1. The EpicentraX Constitution.
2. Applicable Architecture Decision Records (ADRs).
3. Applicable architecture documents.
4. This Development Standards document.

## Architecture Before Implementation

Architecture shall be established before implementation.

Implementation shall not invent architecture while writing code.

When architectural uncertainty exists, implementation pauses until the
architecture is intentionally resolved.

## Documentation Standards

- Markdown documents use ATX headings (`#`, `##`, `###`).
- Documentation is written in clear, direct engineering language.
- Straight quotes are used throughout.
- UTF-8 encoding with LF line endings.
- Approximately 80-column wrapped prose.
- One blank line between paragraphs.
- Architecture documents describe principles rather than implementation.

## Engineering Standards

- Favor the simplest solution that satisfies the architecture.
- Maintain a single source of truth.
- Eliminate duplicate pathways and redundant logic.
- Prefer governed decisions over implicit behavior.
- Fail closed whenever required context is uncertain.
- Preserve provenance and auditability.

## AI Contributor Standards

AI contributors shall:

- Read governing architecture before proposing implementation.
- Never bypass constitutional principles for convenience.
- Explain architectural consequences of proposed changes.
- Distinguish architecture from implementation.
- Avoid unnecessary abstraction and speculative features.
- Prefer readability over cleverness.

## Living Document

These standards evolve deliberately through architectural review. They are
expected to mature alongside the Constitution and the Architecture Decision
Records as EpicentraX continues to evolve.
