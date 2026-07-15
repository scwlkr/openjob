---
id: openjob-v1-08
title: Plan the Global Board Data Migration
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:research
claimed: true
blocked_by:
  - openjob-v1-05
---

## Question

How should the deployed single public Task collection and current Firestore records move into the Group-based model with the smallest safe cutover and an explicit decision about retaining or discarding existing data?

## Answer

Do not migrate the legacy global board into v1. The live board contained zero Tasks on 2026-07-15, and even a late row would lack the Group, verified Member identity, provenance, and trustworthy completion time required for a deterministic conversion.

The [Global Board Data Migration](../research/global-board-data-migration.md) research records the evidence and cutover runbook. v1 starts empty in isolated Group-scoped storage. Before cutover, freeze legacy writes, snapshot and require a zero live count, then deploy the authenticated web and `/api/v1` together. Keep the untouched legacy collection only through acceptance so rollback targets the frozen read-only revision; delete it after the v1 proof passes.
