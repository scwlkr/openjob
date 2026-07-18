# Domain Docs

OpenJob is a single-context repository. Engineering skills consume its domain documentation before exploring or changing the product.

## Before exploring

- Read the root `CONTEXT.md` glossary.
- Read relevant decisions under `docs/adr/`.
- If either is absent, proceed silently; domain-modeling skills create them lazily when decisions require them.

## Use the glossary vocabulary

Use the canonical terms from `CONTEXT.md` in issue titles, specifications, implementation plans, and tests. Do not substitute terms listed under `_Avoid_`.

If a required concept is missing, reconsider whether it belongs to OpenJob's domain or record the gap for a domain-modeling session.

## Respect ADRs

Surface any conflict with an existing ADR explicitly instead of silently overriding it.
