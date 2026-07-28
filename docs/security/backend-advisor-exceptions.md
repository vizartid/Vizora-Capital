# Backend Advisor accepted exceptions

Last reviewed: 2026-07-22

This register covers the 22 findings remaining after migration
`20260722115351_remediate-backend-advisor.sql`. They are intentional security
boundaries, not pending remediations. InsForge currently has no CLI option to
dismiss, suppress, or mark an Advisor finding as accepted risk, so these
findings will remain visible in subsequent scans.

Do not apply the Advisor's generic remediation snippets to these objects
without redesigning and retesting the authorization model described below.

## SECURITY DEFINER functions

All 11 functions have these controls:

- `search_path` is pinned to `pg_catalog, public, pg_temp`.
- `PUBLIC` and `anon` have no execute privilege.
- Only `project_admin` and `authenticated` can execute them.
- Tenant-scoped operations derive the caller from `auth.uid()` and enforce
  membership, role, ownership, or invitation-email checks before mutation.
- The functions are the controlled write surface for tables whose direct
  runtime DML privileges are revoked.

| Function | Accepted rationale |
| --- | --- |
| `is_business_member(uuid)` | RLS helper scoped to `auth.uid()`. It must bypass `business_members` RLS to avoid recursive policy evaluation. |
| `has_business_role(uuid, text[])` | RLS helper scoped to `auth.uid()`. It must bypass `business_members` RLS to avoid recursive policy evaluation. |
| `create_business(text, text, text, text, text, text)` | Authenticated bootstrap transaction; creates a business and administrator membership for the caller atomically. |
| `create_invoice_draft(uuid, uuid, date, jsonb, text, text, uuid)` | Tenant-role-gated transaction that creates an invoice and its line items atomically. |
| `approve_invoice(uuid)` | Administrator/approver-only, row-locked invoice state transition. |
| `mark_invoice_sent(uuid, text)` | Administrator/approver-only, row-locked invoice state transition with audit logging. |
| `record_transaction(uuid, text, text, text, numeric, date, uuid, text)` | Tenant-role-gated ledger write with an atomic linked-invoice update. |
| `approve_ai_action(uuid)` | Administrator/approver-only, row-locked human-approval workflow. |
| `reject_ai_action(uuid)` | Requires a non-null `auth.uid()` and either request ownership or an approving tenant role. |
| `invite_business_member(uuid, text, text)` | Tenant-administrator-only invitation workflow. |
| `accept_business_invitation(uuid, text)` | Requires `auth.uid()` and an unexpired invitation matching the JWT email. |

Converting the first two helpers to `SECURITY INVOKER` would re-enter RLS on
`business_members` and can cause recursive policy evaluation. Converting the
transactional RPCs would require granting direct write privileges and adding
write policies to their base tables, allowing clients to bypass the state,
field, and multi-row invariants enforced by the RPCs.

## SELECT-only RLS tables

All 11 tables have RLS enabled, an authenticated tenant-scoped SELECT policy,
and only the `SELECT` table privilege for the `authenticated` runtime role.
The absence of browser-write policies is intentional.

| Table | Trusted write path |
| --- | --- |
| `business_invitations` | `invite_business_member` and `accept_business_invitation` RPCs |
| `invoice_items` | `create_invoice_draft` RPC and invoice-maintenance triggers |
| `transactions` | `record_transaction` and `approve_ai_action` RPCs |
| `invoice_status_history` | Invoice status-history trigger |
| `chat_messages` | Authenticated Finance API using its server-side client |
| `invoices` | Invoice workflow RPCs |
| `audit_logs` | Audit helper and audit triggers |
| `action_drafts` | Finance API plus approve/reject RPCs |
| `invoice_reminders` | Invoice reminder trigger and trusted worker |
| `payment_orders` | Authenticated checkout route and verified Midtrans webhook |
| `business_subscriptions` | Verified Midtrans webhook |

Adding INSERT, UPDATE, or DELETE policies solely to clear informational Advisor
findings would widen the browser attack surface and invalidate the intended
server/RPC-only write boundary.

## Re-review triggers

Re-open this decision if any of these conditions change:

- a function gains a new parameter, table access, dynamic SQL, or caller role;
- a function loses its pinned `search_path` or an explicit authorization check;
- `PUBLIC` or `anon` receives execute privilege on a listed function;
- an authenticated runtime role receives direct DML on a listed table;
- a browser begins writing one of the SELECT-only tables directly;
- an RLS policy dependency changes, especially around `business_members`;
- InsForge adds an official accepted-risk/suppression mechanism.

After any such change, inspect live function ACLs and `pg_policies`, run the
application test suite, and repeat the Backend Advisor review.
