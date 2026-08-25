-- Invoice review, immutable audit, and controlled adjustment foundation.
-- POS writes are local-first; ERP ingestion must preserve idempotency_key.

create extension if not exists pgcrypto;

create table if not exists public.invoice_review_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null check (btrim(tenant_id) <> ''),
  company_id text null,
  store_id text null,
  transaction_id text not null check (btrim(transaction_id) <> ''),
  transaction_display_id text null,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  category text not null
    check (category in ('PAYMENT_METHOD_ERROR', 'CUSTOMER_DATA', 'TIP', 'FISCAL', 'OTHER')),
  priority text not null default 'NORMAL'
    check (priority in ('LOW', 'NORMAL', 'HIGH')),
  comment text not null check (btrim(comment) <> ''),
  terminal_id text not null,
  created_by_id text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by_id text null,
  resolved_by_name text null,
  resolved_at timestamptz null,
  resolution_comment text null,
  sync_status text not null default 'PENDING',
  sync_error text null,
  check (
    (status in ('OPEN', 'IN_REVIEW') and resolved_at is null)
    or (status in ('RESOLVED', 'DISMISSED') and resolved_at is not null)
  )
);

create table if not exists public.invoice_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null check (btrim(tenant_id) <> ''),
  company_id text null,
  store_id text null,
  transaction_id text not null check (btrim(transaction_id) <> ''),
  transaction_display_id text null,
  event_type text not null
    check (event_type in (
      'REVIEW_FLAGGED', 'REVIEW_STATUS_CHANGED', 'EMAIL_RESENT', 'EMAIL_RESEND_FAILED',
      'VOLUNTARY_TIP_ADJUSTED', 'ECF_CUSTOMER_CORRECTED', 'COMPLIMENTARY_CREATED'
    )),
  previous_data jsonb null,
  new_data jsonb null,
  reason text null,
  metadata jsonb null,
  terminal_id text not null,
  actor_id text not null,
  actor_name text not null,
  authorized_by_id text null,
  authorized_by_name text null,
  occurred_at timestamptz not null,
  idempotency_key uuid not null,
  sync_status text not null default 'PENDING',
  sync_error text null,
  created_at timestamptz not null default now(),
  constraint invoice_audit_events_idempotency_key_unique unique (idempotency_key)
);

create table if not exists public.invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null check (btrim(tenant_id) <> ''),
  company_id text null,
  store_id text null,
  transaction_id text not null check (btrim(transaction_id) <> ''),
  transaction_display_id text null,
  adjustment_type text not null
    check (adjustment_type in ('VOLUNTARY_TIP_ADJUSTMENT', 'ECF_CUSTOMER_CHANGE')),
  previous_data jsonb not null,
  new_data jsonb not null,
  reason_code text not null check (btrim(reason_code) <> ''),
  reason text not null check (btrim(reason) <> ''),
  requested_by_id text not null,
  requested_by_name text not null,
  authorized_by_id text null,
  authorized_by_name text null,
  terminal_id text not null,
  occurred_at timestamptz not null,
  base_revision integer not null default 1 check (base_revision > 0),
  idempotency_key uuid not null,
  fiscal_impact text not null default 'NONE'
    check (fiscal_impact in ('NONE', 'PENDING_FISCAL_RETRY')),
  sync_status text not null default 'PENDING',
  sync_error text null,
  created_at timestamptz not null default now(),
  constraint invoice_adjustments_idempotency_key_unique unique (idempotency_key)
);

create index if not exists invoice_review_flags_tenant_transaction_created_idx
  on public.invoice_review_flags (tenant_id, transaction_id, created_at desc);
create index if not exists invoice_review_flags_tenant_status_updated_idx
  on public.invoice_review_flags (tenant_id, status, updated_at desc);
create index if not exists invoice_audit_events_tenant_transaction_occurred_idx
  on public.invoice_audit_events (tenant_id, transaction_id, occurred_at desc);
create index if not exists invoice_adjustments_tenant_transaction_occurred_idx
  on public.invoice_adjustments (tenant_id, transaction_id, occurred_at desc);

alter table public.invoice_review_flags enable row level security;
alter table public.invoice_review_flags force row level security;
alter table public.invoice_audit_events enable row level security;
alter table public.invoice_audit_events force row level security;
alter table public.invoice_adjustments enable row level security;
alter table public.invoice_adjustments force row level security;

create policy invoice_review_flags_tenant_select
  on public.invoice_review_flags for select to authenticated
  using (
    tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (company_id is null or company_id = (select auth.jwt() -> 'app_metadata' ->> 'company_id'))
    and (store_id is null or store_id = (select auth.jwt() -> 'app_metadata' ->> 'store_id'))
  );

create policy invoice_review_flags_tenant_insert
  on public.invoice_review_flags for insert to authenticated
  with check (
    tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (company_id is null or company_id = (select auth.jwt() -> 'app_metadata' ->> 'company_id'))
    and (store_id is null or store_id = (select auth.jwt() -> 'app_metadata' ->> 'store_id'))
  );

create policy invoice_review_flags_tenant_update
  on public.invoice_review_flags for update to authenticated
  using (
    tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (company_id is null or company_id = (select auth.jwt() -> 'app_metadata' ->> 'company_id'))
    and (store_id is null or store_id = (select auth.jwt() -> 'app_metadata' ->> 'store_id'))
  )
  with check (
    tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (company_id is null or company_id = (select auth.jwt() -> 'app_metadata' ->> 'company_id'))
    and (store_id is null or store_id = (select auth.jwt() -> 'app_metadata' ->> 'store_id'))
  );

create policy invoice_audit_events_tenant_select
  on public.invoice_audit_events for select to authenticated
  using (
    tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (company_id is null or company_id = (select auth.jwt() -> 'app_metadata' ->> 'company_id'))
    and (store_id is null or store_id = (select auth.jwt() -> 'app_metadata' ->> 'store_id'))
  );

create policy invoice_audit_events_tenant_insert
  on public.invoice_audit_events for insert to authenticated
  with check (
    tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (company_id is null or company_id = (select auth.jwt() -> 'app_metadata' ->> 'company_id'))
    and (store_id is null or store_id = (select auth.jwt() -> 'app_metadata' ->> 'store_id'))
  );

create policy invoice_adjustments_tenant_select
  on public.invoice_adjustments for select to authenticated
  using (
    tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (company_id is null or company_id = (select auth.jwt() -> 'app_metadata' ->> 'company_id'))
    and (store_id is null or store_id = (select auth.jwt() -> 'app_metadata' ->> 'store_id'))
  );

create policy invoice_adjustments_tenant_insert
  on public.invoice_adjustments for insert to authenticated
  with check (
    tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (company_id is null or company_id = (select auth.jwt() -> 'app_metadata' ->> 'company_id'))
    and (store_id is null or store_id = (select auth.jwt() -> 'app_metadata' ->> 'store_id'))
  );

revoke all on public.invoice_review_flags from anon;
revoke all on public.invoice_audit_events from anon;
revoke all on public.invoice_adjustments from anon;

grant select, insert, update on public.invoice_review_flags to authenticated;
grant select, insert on public.invoice_audit_events to authenticated;
grant select, insert on public.invoice_adjustments to authenticated;

comment on table public.invoice_review_flags is 'Structured invoice review workflow. Deletes are intentionally not granted.';
comment on table public.invoice_audit_events is 'Append-only audit events for invoice operations.';
comment on table public.invoice_adjustments is 'Append-only controlled changes; the original transaction remains immutable.';
