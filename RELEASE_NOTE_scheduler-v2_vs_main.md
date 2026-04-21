# Release Note

## Overview

This release describes the new capabilities introduced by the current `scheduler-v2` branch compared with `main`, which is intended to be replaced by this version.

This update represents a major evolution of the IOTA Distributed Oracle platform and introduces three main areas of progress:

- support for on-chain scheduled tasks;
- direct node and proposal management from the interface;
- expanded application capabilities with new LLM tasks and supporting backend endpoints.

## Key Enhancements

### 1. On-chain task scheduling

The most significant addition in this release is a full on-chain scheduling system for recurring task execution.

Specifically, this release adds:

- new Move modules for scheduled tasks (`oracle_scheduled_tasks.move`);
- a shared scheduler queue across nodes with processing rounds and handover logic;
- support for scheduled task states such as `ACTIVE`, `SUSPENDED`, `CANCELLED`, and `ENDED`;
- dedicated balance funding for scheduled tasks;
- tracking for `start`, `end`, `interval`, `next run`, `last run`, and the last scheduler node that processed the task;
- dedicated on-chain events for creation, funding, suspension, reactivation, completion, and queue progression.

On the node side, the release introduces:

- a dedicated scheduler handler;
- scheduler state reading and due-task discovery;
- workers and services for scheduling rounds, queue reconciliation, and execution submission;
- watchdog logic to abort runs that remain open for too long.

Result: the system is no longer limited to manual or event-driven execution, and can now orchestrate recurring tasks natively.

### 2. Node management and template governance

The webview now includes a dedicated node administration area.

New capabilities include:

- a dedicated `Node Management` page;
- updating the templates supported by each node;
- support for enabling the scheduler role through a dedicated template;
- viewing and approving template proposals;
- wallet integration for signed on-chain management actions.

This makes node operations much easier to manage without relying exclusively on scripts or CLI workflows.

### 3. Scheduled task UI

The webview now includes a dedicated experience for scheduled tasks.

New additions include:

- a `Task Schedules` page;
- retrieval of existing schedules;
- visibility into status, interval, time windows, executed runs, and available balance;
- wallet actions for controlling scheduled tasks;
- routing and client/server API updates to support the new workflow.

This significantly improves usability for demos, operations, and troubleshooting.

### 4. New LLM Open Question task

A new `LLM_OPEN_QUESTION` handler has been added, together with related examples in the node, client, and webview layers.

This task:

- accepts an open-ended question;
- builds a deterministic prompt;
- requires canonical JSON output;
- is designed for use cases where a short, current answer is needed.

This extends the existing LLM template catalog and enables more flexible use cases.

### 5. Backend and operational tooling improvements

This release also strengthens the surrounding application infrastructure:

- new server services for `taskSchedules`, `scheduledTasks`, `nodeManagement`, `oracleClient`, `oracleStatus`, and market data;
- updates to `.env` configurations and devnet examples;
- new scripts for devnet deployment and environment updates;
- updates to template proposal scripts and related tooling;
- addition of EULA/Terms content in the webview.

## Platform impact

With this release, the platform moves from a model focused mainly on oracle task execution to a more complete operating model that includes:

- recurring task orchestration;
- operational node control;
- greater autonomy through the frontend;
- a broader set of supported templates.

In practical terms, the version intended to replace `main` is much closer to a complete operational console than to a simple task testing environment.

## Areas affected

The changes span all major blocks of the project:

- `iota_oracle_move`
- `iota_oracle_node`
- `iota_oracle_webview`
- `iota_oracle_client`

The delta versus `main` is substantial: `139` files changed, with approximately `16,573` lines added and `1,208` lines removed.

## Operational note

The branch also contains some generated files or conflict-derived snapshot copies, as well as several `.js` files alongside `.ts` sources. These do not change the functional message of the release note, but they should be reviewed for cleanup before definitively replacing `main`.

## Executive summary

`scheduler-v2` introduces an on-chain scheduling layer, brings node and schedule management into the webview, and adds a new LLM template for open-ended questions. This is a structural release rather than an incremental one: it significantly expands the project’s functional surface and improves operational usability, automation, and governance.
