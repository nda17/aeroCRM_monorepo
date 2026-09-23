# WS-01: implementation contract, 2026-09-23

Status: architecture for the approved release; this file does not implement or execute closure.
Scope: permanently stop one workspace, retain its history and financial facts. No hard delete,
reopen, replacement workspace, refund, or account deactivation. The orchestrator belongs to
CRM Access; no new service, queue framework, or Platform lifecycle is required.

## 1. Durable state and public ABI

Add `CrmWorkspaceClosure` / `crm_access.crm_workspace_closures`:

- `id uuid PK`, `workspace_id uuid UNIQUE`, `command_id uuid UNIQUE`;
- `owner_subject text`, `owner_membership_id uuid`, `request_hash varchar(64)`;
- `display_name_snapshot varchar(200)`, `generation bigint NOT NULL DEFAULT 1`;
- `state varchar(16)` constrained to `CLOSING|CLOSED`, `version bigint DEFAULT 1`;
- `participants jsonb`: exact bounded map for `crm-access`, `identity`, `billing`,
  `crm-customers`, `crm-sales`, `crm-intake`, `notification-delivery`;
- each map value: `{state: PENDING|FENCED|SETTLED, fencedAt: ISO|null,
  settledAt: ISO|null, lastErrorCode: string|null}`;
- `lease_token uuid NULL`, `lease_until timestamptz NULL`, `next_attempt_at timestamptz`;
- `last_error_code varchar(80) NULL`, `requested_at`, `updated_at`, `closed_at NULL`;
- `financial_pending_count integer DEFAULT 0`, `prior_dispatch_count integer DEFAULT 0`.

No second close generation is issued in v1. Generation is nevertheless transmitted and
checked with the operation ID; it is not a lease, elapsed time, or permission to reopen.
The worker has a separate lease token/version CAS, so a recovered old worker cannot overwrite
newer acknowledgments. Reuse existing team audit for REQUESTED / PARTICIPANT_FENCED /
PARTICIPANT_SETTLED / CLOSED; do not write bearer tokens, invite links, source secrets, or PII
payloads into the closure row.

Public routes under existing `/crm/access`, all bearer-authenticated and `no-store`:

1. `GET /workspaces/:workspaceId/closure-preview`:
   `{schemaVersion:1,scope:{subject,workspaceId},enabled:boolean,version:"0",
   confirmationLabel:string,closure:ClosureView|null}`. `enabled` also requires the rollout
   feature gate and current canonical owner. Non-owners receive 403, not a misleading preview.
2. `POST /workspace-closures`, `Idempotency-Key == commandId`:
   `{schemaVersion:1,commandId:uuid,workspaceId:uuid,expectedVersion:"0",
   confirmationLabel:string}`. Validate the exact preview label again under local lock;
   a changed label requires a refreshed confirmation. Persist operation + CRM Access local
   fence + audit in one transaction; return 202 with `{schemaVersion:1,closure:ClosureView}`.
3. `GET /workspace-closures/:id` returns the same view with HTTP 200.
4. `GET /workspace-closures` returns
   `{schemaVersion:1,scope:{subject},items:ClosureView[]}` for the current canonical owner only.

Closed financial views are separate GET-only routes: `GET /workspace-closures/:id/billing`
returns `{schemaVersion:1,workspaceId,actorSubject,billing:<existing CrmCommerceSummary>}`;
`GET /workspace-closures/:id/billing/history?page=&pageSize=` and
`GET /workspace-closures/:id/billing/orders/:orderId` reuse the existing strict history/order
response bodies. Each resolves the closure ID to its workspace and revalidates the closed
owner before returning data. No checkout/verify-payment/recover-charge capability is exposed.
Do not loosen the general `billing-capacity.owner()` for mutation callers.

`ClosureView` exact keys:
`{id,workspaceId,displayName,state,version,requestedAt,closedAt,steps,
financialPendingCount,priorDispatchCount,lastErrorCode}`.
`version` is a positive decimal string; dates are ISO or null; `steps` is an ordered array of
`{service,state,lastErrorCode}` with the seven service names above. No tokens or internal URLs.
The two counts are snapshots recorded at the participant fence, not a claim that subsequent
provider results remain unknown; the financial GET views show current order state.

Same command/actor/workspace/hash returns the original operation and can wake its existing
retry; a different command for an already closing workspace returns 409
`crm_workspace_closure_exists` with its operation ID only after owner authorization.
Do not require still-ACTIVE workspace membership to replay/read the existing operation.
Authentication must still be a fresh valid session for an active user. Add a separate Identity
closure-owner context which checks the preserved unique OWNER and (for INACTIVE workspace)
the matching local closure fence. Do not broaden the old `owner-context` or `auth-context` ABI.
Ownership is rechecked at Identity's fence transaction; a mismatch leaves CLOSING with an
explicit error, never a forged owner receipt.

CRM Access continues exposing legacy lifecycle `SUSPENDED`; keep old bootstrap and authority
DTO enums unchanged. New UI reads closure separately. `reconcileAccessProfile`, onboarding,
team admission, late Billing synchronization and paid entitlement callbacks must not clear a
local fence or change SUSPENDED back to ACTIVE.

## 2. Participant ABI and execution order

Each participant exposes service-authenticated, loopback-only:

`POST /internal/v1/workspace-closures/fence`

Request exact keys:
`{schemaVersion:1,closureId:uuid,workspaceId:uuid,generation:"1",ownerSubject:string,
requestedAt:ISO}`.

Response exact keys:
`{schemaVersion:1,service,closureId,workspaceId,generation:"1",state:"FENCED",
fencedAt:ISO,financialPendingCount:nonnegativeInteger,priorDispatchCount:nonnegativeInteger}`.
Non-Billing/non-Notification services return zero for their irrelevant counts. Acknowledgment
means the local fence and local closure actions have COMMITTED, not merely been enqueued.
Repeat of the same binding returns the stored ACK. A different closureId/generation for an
already fenced workspace is 409; malformed/unsupported contracts fail closed. HTTP loss is
retried with identical binding. Never use a new command or delete a fence during recovery.

CRM Access existing worker process (`runtime.workerEnabled`) scans due CLOSING rows, following
`billing-reconciliation.service.ts` DB queue pattern. Claim with lease/version CAS, short local
transactions, bounded HTTP outside transactions, backoff and safe machine error codes.

Execution:

1. Public command commits CRM Access fence and SUSPENDED, immediately denying new normal
   authority. Set SUSPENDED only if an access profile already exists; do not fabricate an
   entitlement/profile to close a not-yet-activated Identity workspace. Public response means
   closing REQUESTED, not globally closed.
2. Fence Identity, Billing, Customers, Sales, Intake and Notification Delivery. Retry each
   unfinished participant independently. Database ACK snapshots, not the worker's memory,
   determine progress. Identity and Billing can run first; Customers + Sales must both ACK
   before Intake settlement.
3. `POST /internal/v1/workspace-closures/settle` on Intake accepts the same closure envelope
   plus `{customersFencedAt:ISO,salesFencedAt:ISO}`; do not treat client-supplied timestamps as
   authorization. This route trusts only authenticated CRM Access, checks its own matching
   fence, and the orchestrator calls it only from persisted ACKs. It processes a bounded page
   and returns common binding plus `{state:"SETTLING"|"SETTLED",remaining:number}`.
   Persist any cursor locally or derive remaining from nonterminal acceptance rows.
4. Mark all no-settlement participants SETTLED after their fence ACK, Intake after SETTLED.
   Commit CLOSED only when every participant is FENCED/SETTLED and Intake is SETTLED.
   Existing payment/delivery UNKNOWN is a retained financial/delivery fact, not an infinite
   closure blocker. Expose counts; continue existing reconciliation separately.

No transaction spans databases. On dependency outage the truthful state remains CLOSING.
Automatic retry resumes when that dependency recovers. There is no correctness-preserving
deadline which turns an unacknowledged participant into CLOSED.

## 3. Local database fence and race rule

Each affected service has an additive local `workspace_closure_fences` table:
`workspace_id uuid PK, revision bigint NOT NULL DEFAULT 0, closure_id uuid NULL,
generation bigint NULL, owner_subject text NULL, requested_at timestamptz NULL,
fenced_at timestamptz NULL`. All closure fields are null for OPEN; all are set for FENCED.
Fence binding is immutable. Do not expose a clear/reopen function.

Use SQL triggers on the business-table inventory below. The trigger calls a local routine
which **writes** the fence row before allowing a business change, e.g. atomic
`INSERT ... OPEN ... ON CONFLICT (workspace_id) DO UPDATE SET revision = revision + 1
WHERE workspace_closure_fences.fenced_at IS NULL RETURNING workspace_id`.
No returned row means `crm_workspace_closed`; translate this known DB refusal to a stable
403 error instead of a generic 500. Use a dedicated SQLSTATE/detail and verify actual Prisma
error wrapping in an integration test. On SERIALIZABLE a concurrent fence can cause 40001 /
P2034; existing bounded transaction retry remains necessary. Do not interpret serialization
failure as a successful command.

Installing the fence writes the SAME row. Thus either the business transaction commits first,
or it aborts/refuses; an old authorization snapshot cannot write after fence ACK. Pure
advisory lock + SELECT is insufficient with a stale SERIALIZABLE snapshot. Do not hold this
lock across HTTP, SMTP, Telegram, provider calls, or user interaction. The consequence is
serialization of writes within one workspace; different workspaces remain independent.

Triggers must refuse workspace_id changes (or acquire OLD/NEW guards in deterministic order).
Use schema-qualified routines and bounded search_path. Inventory runtime permissions and
routine ownership explicitly; no general `SET LOCAL bypass_closure` escape hatch.

## 4. Guard inventory and service-specific actions

Full INSERT/UPDATE/DELETE guard unless a narrower rule is stated:

| Schema | Business tables |
| --- | --- |
| crm_customers | companies, contacts |
| crm_sales | pipelines, pipeline_stages, pipeline_template_installations, deals, tasks, commerce_catalog_items, commerce_deal_lines, commerce_quotes, commerce_payments, task_series, task_series_occurrences, reminder_rules |
| crm_intake | intake_sources, inbox_entries, csv_imports, csv_import_rows, sla_rules |
| crm_access | crm_workspace_access, crm_workspace_branding, crm_workspace_members, crm_custom_roles, crm_employee_profiles, crm_teams, crm_member_teams |
| identity | workspace_members for admission/reactivation/role changes; workspace_invitations for creation/acceptance/reactivation; workspaces for transition to ACTIVE |

Additional admission-only triggers: INSERT of `intake_operation_slots` with COMMITTED state
in BOTH Customers and Sales (including an EXISTING contact, which otherwise writes no guarded
contact row); INSERT of Sales `task_notifications`, Intake `sla_notifications` and
`inbox_notifications`; INSERT of `commerce_import_previews`. Cleanup/receipt/terminal-update
paths on those control records remain available. Guard new local invitation/admission intent
creation too; technical finalization does not grant a member because member writes are fenced.

CRM Access: set SUSPENDED before marking its fence within the same local transaction. Cancel
pending local invitation/admission intents before fencing; technical receipt and queue
cleanup can continue. Terminal member disabling / invitation revocation may be narrowly
allowed after fencing, but never activation or role reassignment. Never disable the user.

Identity: one transaction validates unique canonical owner, locks its local fence row, marks
only this Workspace INACTIVE, revokes its PENDING invitations, then installs fence. Preserve
memberships as history, including owner relation. Existing accepted membership cannot grant
CRM access through INACTIVE workspace. Standalone session/password/profile and other
workspaces are unchanged. `UsersService.ensurePersonalWorkspace` must not create a replacement
as a side effect of closure.

Intake: guard INSERT/new retry/recovery start on `acceptances`, while allowing only technical
completion/cancellation/receipt updates afterward. Fence invalidates active acceptance claims
with generation increment + lease clear. Preserve outbox rows and their existing
PENDING/PUBLISHING/PUBLISHED constraint; stale queued events resolve to the normal delivered
no-op after checking the changed generation. Do not invent a CANCELLED outbox state or delete
historical events to suppress retries. New acceptance/retry enqueue admission is refused.
Original workflow generation is NOT reused by closure settlement. Keep operation IDs/payload
hashes so canonical target proofs can still be read. New API/Tilda/manual/CSV writes fail;
do not return a successful intake receipt for a rejected request.

After Customers and Sales ACK, their business facts cannot change. Existing read-only
`intake-operations` proof endpoints intentionally work without current actor write authority:

- Sales COMMITTED plus matching Customers COMMITTED: finalize acceptance COMPLETED, restore
  contact/deal/firstTask IDs from validated bound proofs, finalize entry ACCEPTED and audit.
- Sales ABSENT or CANCELLED: mark acceptance CANCELLED with `WORKSPACE_CLOSED`; keep any
  COMMITTED contact ID/proof and existing contact history. Leave the entry content intact.
  Because the two target fences are irreversible, ABSENT is now stable; no new operation,
  new key, generic rollback, or extra tombstone endpoint is needed.
- Mismatched proofs are a real integrity error, remain visible and block CLOSED; do not fake
  cancellation. Transient proof-read errors retry with the same operation binding.

`inbox_entries` guard needs one explicit terminal exception: under a matching closed fence,
NEW -> ACCEPTED may change ONLY status/contact_id/deal_id/accepted_at/version/updated_at and
must match a COMPLETED acceptance with the same workspace/entry and validated stored proofs.
Implement that narrow condition/routine, not a broad guard bypass. Other edits still refuse.
Stale ordinary workers fail their old generation/lease CAS. Technical control rows are not
globally frozen, so closure does not deadlock on its own settlement.

Sales workers: exclude fenced workspaces from recurring task generation, reminder jobs and
dispatch claims; already queued events reach terminal skipped/closed outcome instead of
endless retries. Task status/history stays unchanged. Local task/table triggers are the final
backstop if stale authority or an old queued event passes an application check.

Do NOT blanket-guard receipts, audit/timelines, outbox/consumer receipts, payment/provider
state, acceptance operation slots/commands, existing delivery records, closure/control rows,
or export audit. They record already committed outcomes. Guard their *new-work admission*
paths as listed above. Notifications and SLA/task dispatch control rows permit terminal skip
and lease cleanup, but not a new dispatch permit after fencing. A table inventory test should
make an unreviewed future tenant business table visible.
For generic public command wrappers (`team.util.command`, Customers/Intake/Sales `command`),
also invoke the same guard at new-command admission, before the action. This covers a command
which only writes an audit/note/receipt or becomes a no-op. Receipt recovery reads and dedicated
closure/Billing settlement bypass that PUBLIC admission wrapper, not the database guard.
There is no need to add manual guards to every business transaction once its tables are guarded.

## 5. Billing and external dispatch

Billing needs its own local fence even when CRM Access already denies the user. Reuse
`billing-crm-entitlement:<workspaceId>` locking and `crm-commerce.service.ts` transaction
wrapper. Add fence checks to `accountForCommand`, trial/admin grant/seat mutation entrypoints,
`beginProviderDispatch` CREATE, and recurring-order scheduling. DB guards: INSERT of new
`crm_orders`, `crm_admin_day_grants`, `crm_admin_seat_adjustments`; transition/upsert of
`crm_auto_renewals` to ACTIVE. Do not blanket-freeze financial account/period/receipt tables:
late provider outcomes must still be durably recorded.

Closure transaction scopes the existing `internal-commands.service.ts:revokeCrmOwner` pattern
to ONE workspace (never invoke the owner-wide method): revoke its renewal, preserve encrypted
method/history, clear future schedule/dispatch flags; cancel never-dispatched PENDING orders;
already dispatched PENDING become UNKNOWN; strip autoRenew and confirmation URL. Preserve
provider keys/payment IDs, successful periods and payment receipts. Durable local fence is
written in the same transaction. New CREATE dispatch is refused even for an old queued job.
Allow provider GET/webhooks/status reconciliation, not an automatic new charge or refund.

In the success handler, a closed fence ALWAYS prevents renewal activation/upsert and access
reactivation, including when no renewal row existed at closure. Existing `status !== REVOKED`
check alone is insufficient for the absent-row case. Recording actual payment success and
its period remains permitted; owner can view it from closure card using a new read-only
closed-owner authority path. Do not widen authority for checkout, seats, grants or retry-charge.

Notification Delivery has no workspace column in its receipt today. Add nullable
`crm_workspace_id`, `crm_dispatch_started_at` to `delivery_receipts` plus a workspace index.
CRM invitation/reminder/SLA adapters know workspaceId from validated context. Immediately
before invoking a transport, claim a durable dispatch permit in a short transaction that
writes the local workspace fence guard and verifies receipt lockToken/lease. Non-CRM email,
account recovery and support continue under existing behavior. Closure writes the same fence;
after ACK, no new CRM transport attempt/automatic retry/manual retry can obtain a permit.
Previously started attempts may finish and record outcome; unknown transport outcome must
not cause automatic resend after closure. Existing queue items without receipt metadata are
also denied when they later request a permit. Never infer workspaceId from an arbitrary label.

No service can recall a request already handed to an external provider. UI wording must say
that previously started payments/messages may finish later. CLOSED means all durable barriers
deny new work and internal acceptance outcomes have settled; it does not pretend an atomic
cross-provider cancellation or require an UNKNOWN provider fact to become known first.

## 6. Exact implementation ownership and anchors

All service paths below relative to `aeroCRM_services/apps/`:

- CRM Access owner: new `workspace-closure/` controller/service/worker/client; register in
  `src/crm-access.module.ts`, worker role via `src/runtime/crm-access-runtime.service.ts`.
  Existing anchors `src/team/team.util.ts:94`, `src/access/crm-access.service.ts:275,373`,
  `src/authorization/crm-authorization.service.ts:180`, `src/team/team-admission.service.ts:348`,
  `src/billing/billing-capacity.service.ts:104`, `src/billing/billing-reconciliation.service.ts`.
- Identity owner: `src/internal/internal.controller.ts`, `internal.service.ts`,
  `src/workspaces/workspace-invitation.service.ts:195,425`, schema/migration/ACL.
  Add dedicated closure-owner context and fence endpoint; old contracts unchanged.
- Billing owner: `src/http/billing-crm-access.controller.ts`,
  `src/domain/crm-commerce.service.ts:828,1264,2187,2438`,
  `src/domain/crm-entitlement.service.ts`, `crm-admin-subscription.service.ts`,
  `internal-commands.service.ts:36`; local fence + new read-only closed-owner views.
- Customers/Sales owner: SQL fence triggers + local internal fence endpoint; reuse Sales
  `src/internal/crm-sales-internal.guard.ts` for CRM Access caller. Preserve
  `src/intake-operations/intake-operation.service.ts:read` recovery semantics.
  Sales also `src/recurring-tasks/task-series-generation.service.ts:124`, reminders services.
- Intake owner: SQL triggers + fence/settle endpoints; existing ingestion source lock
  `src/intake/intake-ingestion.service.ts:253`; settlement reuses proof/parser and terminal
  logic from `src/acceptance/acceptance.processor.ts:198,402`; source/CSV commands guarded by DB.
- Notification owner: `src/notification-delivery/notification-delivery-receipt.service.ts`,
  `notification-delivery-adapter.service.ts`, `notification-delivery-worker.service.ts`,
  CRM context services and existing manual retry/control path.

Existing internal credentials for Identity/Billing/Sales can authenticate their existing
CRM Access caller on the new tightly scoped route. Add per-target CRM Access credentials for
Customers, Intake, Notification Delivery only if absent; never reuse an opposite-direction
token or a provider/source key. Update bounded clients, config validation, private env manifests,
CI fixtures and deployment preflight without printing secret values.

Suggested implementation units: (A) schema/trigger/ABI + server feature gate default false;
(B) participant handlers and terminal settlement; (C) orchestrator + owner views;
(D) frontend closure confirmation/card; (E) focused concurrency/recovery tests and infra hook.
Independent service files may be split across Sol; one owner should own the shared ABI and
release/migration inventory. Luna can implement DTO/parser fixtures after this ABI is fixed.

## 7. Migration, rollout and required evidence

Additive migrations for the seven affected schemas, `prisma/database-access.json` updates,
routine grants, backup/restore table inventory and Operations migration/checksum manifest.
No migration rewrites old rows to CLOSED; OPEN fence rows can be created lazily. Backfill only
if needed for an established DB invariant. Preserve all history; no DROP or cascade delete.

Use the established target-host migration hook pattern from
`aeroCRM_infra/scripts/crm-intake-notifications-migration.mjs` and
`crm-sales-commerce-migration.mjs`: immutable image SHA, exact reviewed migration/checksum
inventory, private migration env hash, role/schema checks, `/opt/aerocrm`, `release.lock`,
bounded commands, before/after verification and suppressed private command output.
Wire a WS-01 multi-service additive hook into monorepo `.github/workflows/release.yml`.
Update `aeroCRM_infra/scripts/database-access*` generated policy and Operations
`backup-manifests/database-backup-migrations.json`/restore inventory through existing
`apps/operations/scripts/database-backup-migration-manifests.mjs` and
`database-restore-migration-manifests.mjs` generators.

Rollout: migrate while closure feature is OFF; deploy every compatible API/worker/outbox
process; verify participant capability versions, trigger/ACL inventory and expected image
SHA; only then enable the server gate and closure UI. A rolling deployment with an old
Notification/Billing worker is not ready. An application rollback after the first real close
must preserve fence-aware code/DB enforcement; never roll back to code that can dispatch
without a fence. Turning OFF admission of new closures does not stop recovery of CLOSING rows.

Focused tests: same-key lost response/replay; foreign/member/disabled user; concurrent close
with source/manual/CSV write and SERIALIZABLE old snapshot; task/commerce write; invitation
acceptance; late team/Billing reactivation; closure process crash after target commit before
ACK; stale worker lease; half-completed acceptance preserving committed contact; committed
sales recovered from proof after actor access lost; provider unknown/late success with no
renewal row; queued and already started notification, no post-fence resend; other workspace
unaffected; history retained. Use real PostgreSQL for trigger/race tests, not Prisma mocks.
Production smoke closes only a dedicated test workspace and verifies API/Tilda refusal,
owner closed card and another test workspace still writable.

## 8. Implemented verification entry points

The `workspace-closure-postgres18` CI job applies each service migration chain to a
separate PostgreSQL 18 database, grants the service-owned runtime ACL, and runs
`aeroCRM_services/scripts/workspace-closure-postgres18.integration.mjs`. The harness
checks permanent fence binding, forbidden writes, isolation, concurrent writers and
stale SERIALIZABLE snapshots. Its CRM Customers Prisma check exercises both OPEN
admission and the real wrapped database refusal; SQL functions returning `void`
must be called through `$executeRaw`, not `$queryRaw`.

For local verification, `scripts/setup-workspace-closure-pg18-fixtures.mjs` targets
only the named Colima test context `colima-aerocrm-commerce-test` and container
`aerocrm-commerce-pg18` on loopback port 55438. It refuses existing fixture names
and an existing private manifest. `WORKSPACE_CLOSURE_TEST_SUFFIX` selects a fresh
fixture set. The generated `.deploy/workspace-closure-test.env` stays outside Git;
apply the real Prisma migrations and service ACL before running the harness with
those private variables. Never point this harness at production.

The `workspace-closure-unit` CI matrix covers Access, Customers, Identity, Billing
and Notification Delivery. Sales and Intake run their closure specs in their
existing complete unit jobs. Frontend tests cover command replay after an unknown
result, session/workspace changes, stale owner data and the all-closed owner view.
These checks and an orchestration smoke do not themselves prove an authenticated
browser closing a real workspace; release evidence must identify that boundary.
