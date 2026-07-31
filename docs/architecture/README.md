# EpicentraX Architecture Library

> **Purpose**
>
> This library documents the enduring architectural principles that govern the EpicentraX platform.
>
> These documents are not implementation guides. They describe the reasoning, philosophy, and design decisions that shape every part of the system.
>
> As EpicentraX evolves, implementations may change, technologies may change, and coding standards may evolve. The architectural principles documented here are intended to remain stable and provide continuity throughout the life of the platform.

---

# Architecture Hierarchy

```
Constitution
        │
        ▼
Architecture Decision Records (ADRs)
        │
        ▼
Engineering Standards
        │
        ▼
Implementation
        │
        ▼
Source Code
```

Each layer builds upon the one above it.

- **The Constitution** defines the enduring principles of EpicentraX.
- **Architecture Decision Records (ADRs)** explain major architectural decisions.
- **Engineering Standards** describe implementation expectations.
- **The Codebase** is the current implementation of those principles.

---

# Architecture Documents

| ADR     | Document                                   | Purpose                                                                                    | Status         |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------- |
| ADR-000 | EpicentraX Constitution                    | Foundational principles governing the platform.                                            | Active         |
| ADR-001 | Operational Intelligence Engine            | Defines the platform intelligence model and evidence-based recommendations.                | In Development |
| ADR-002 | Admin Workspace Architecture               | Defines operational context and event workspace management.                                | In Development |
| ADR-003 | Participant Identity Model                 | Defines participant identity, lifecycle, and historical integrity.                         | In Development |
| ADR-004 | Tenant Identity Framework                  | Defines organizational identity, branding, terminology, and tenant context.                | In Development |
| ADR-005 | Identity, Authentication & Authorization   | Defines authentication, authorization, tenant membership, permissions, and security model. | In Development |
| ADR-006 | Event Context Architecture                 | Defines operational event context and event lifecycle.                                     | Planned        |
| ADR-007 | Data Ownership & Isolation                 | Defines ownership, stewardship, tenant isolation, and data lifecycle.                      | Planned        |
| ADR-008 | Operational Permission Framework           | Defines permissions, role assignments, and operational authority.                          | Planned        |
| ADR-009 | Tenant Branding & White-Label Architecture | Defines branding, terminology, theming, and white-label capabilities.                      | Planned        |
| ADR-010 | AI Trust & Learning Architecture           | Defines AI governance, tenant learning boundaries, trust, and evidence-based intelligence. | Planned        |
| ADR-011 | Person-Centered Workspace Resolution       | Defines the unified Workspace Resolver governing all EpicentraX workspaces, activities, responsibilities, assignments, operational presence, and effective authority. | Proposed       |

---

# Guiding Principles

Every architectural decision should reinforce the following principles:

- Build systems that reflect the real world.
- Every important concept has one authoritative identity.
- Every important concept has one authoritative context.
- Every important concept has one source of truth.
- Organizations own their experience.
- Participants own their identities.
- Artificial Intelligence advises. Humans decide.
- Security and trust are foundational, not optional.
- Long-term clarity is preferred over short-term convenience.

---

# Creating New ADRs

A new Architecture Decision Record should be created whenever a discovery establishes a new long-term architectural principle.

Good candidates include:

- Identity
- Security
- Data ownership
- Operational workflows
- Intelligence
- User experience architecture
- Platform capabilities
- Major architectural patterns

Feature implementations should generally **not** receive an ADR unless they introduce a new architectural principle.

---

# Relationship to Engineering

Developers should read the documents in this order:

1. ADR-000 — EpicentraX Constitution
2. Relevant ADR(s)
3. Engineering Standards
4. Database Design
5. Source Code

Architecture should always drive implementation—not the other way around.

---

# Living Documents

This library is intended to evolve.

As EpicentraX grows, these documents should be refined to better express the platform's principles.

Architectural principles should change deliberately and infrequently.

Implementation may evolve frequently.

The goal of this library is to preserve the reasoning behind EpicentraX so that future developers understand not only **how** the platform works, but **why** it was designed this way.
