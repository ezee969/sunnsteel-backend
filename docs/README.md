# Sunnsteel Backend — Optimized Documentation Index

A comprehensive, hierarchical index of all backend documentation. Each entry includes type, purpose, and last update for quick navigation and governance.

## Overview & Governance
- `./CONTENT_OUTLINES.md` — Type: Plan — Purpose: Detailed content outlines across sections — Last Updated: 2025-10-02
- `./STYLE_GUIDELINES.md` — Type: Style Guide — Purpose: Writing, structure, formatting, and templates — Last Updated: 2025-10-02

## Getting Started
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| Onboarding Guide | `./getting-started/README.md` | Guide | New developer overview and flow | 2025-09-27 |
| Installation | `./getting-started/INSTALLATION.md` | Guide | Prereqs, environment, DB init | 2025-09-27 |
| Quick Start | `./getting-started/QUICK_START.md` | Guide | 5-minute setup and first API calls | 2025-09-27 |

## Architecture
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| Architecture Overview | `./architecture/README.md` | Overview | System design and patterns | 2025-10-02 |

## Authentication
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| Quick Reference | `./authentication/QUICK_REFERENCE.md` | Reference | Supabase/JWT key flows and tips | 2025-10-02 |
| Supabase Auth | `./authentication/SUPABASE_AUTH.md` | Guide | Supabase integration, flows, and migration | 2025-10-02 |

## API
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| API Overview | `./api/README.md` | Overview | Conventions, standards, getting started | 2025-10-02 |
| Users API | `./api/USERS.md` | Reference | User management endpoints | 2025-09-27 |

## Modules
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| Module Overview | `./modules/README.md` | Overview | Module architecture and scope | 2025-09-27 |

## Features
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| Features Overview | `./features/README.md` | Overview | Advanced features summary | 2025-09-27 |
| Progression Schemes | `./features/PROGRESSION_SCHEMES.md` | Reference | RtF progression scheme catalog | 2025-10-02 |

## Development
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| Development Overview | `./development/README.md` | Overview | Processes, workflows, and tooling | 2025-09-27 |

## Deployment
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| Deployment Overview | `./deployment/README.md` | Overview | Deployment processes and environments | 2025-09-27 |

## Reference
| Resource | Path | Type | Purpose | Last Updated |
|----------|------|------|---------|--------------|
| Environment Variables | `./reference/ENVIRONMENT_VARIABLES.md` | Reference | Complete environment setup guide | 2025-09-25 |
| Workout Sessions | `./reference/WORKOUT_SESSIONS.md` | Reference | Session lifecycle and invariants | 2025-09-25 |

## Navigation Aids
- Consistent relative links from `./docs/README.md`.
- Category grouping mirrors repository directories for discoverability.
- Use the Style Guide to standardize new docs; outline new content via CONTENT_OUTLINES.

## Maintenance & Updates
- Weekly link check and quarterly structure review.
- Update “Last Updated” based on file modification timestamps.
- Add new docs under the closest category and append entries here.

## Consolidation Assessment
- Content overlap: Minimal. CONTENT_OUTLINES (planning) and STYLE_GUIDELINES (standards) serve distinct roles not covered by a single index.
- Maintenance overhead: Low. Keeping plan and style separated prevents README bloat and reduces churn when guidelines evolve.
- User navigation: Better with a central index plus specialized documents. The index remains concise; deep guidance lives where appropriate.
- Discoverability: Improved. A single index points to all resources; dedicated planning/style docs are easier to locate and maintain.

Recommendation: Do not consolidate into a single README. Retain `CONTENT_OUTLINES.md` and `STYLE_GUIDELINES.md` as separate governance documents, with this optimized README acting as the unified entry point and map.

—
Last Updated: 2025-10-02
Documentation Owner: Backend Development Team
