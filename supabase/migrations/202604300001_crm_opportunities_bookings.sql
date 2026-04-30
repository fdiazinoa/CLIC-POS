-- CLIC ERP/POS CRM & Bookings expansion
-- Adds opportunity pipeline support and links bookings with sales documents and customer advances.

create extension if not exists pgcrypto;

create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  customer_id uuid null,
  prospect_name text null,
  assigned_user_id uuid null,
  stage text not null default 'NEW'
    check (stage in ('NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST')),
  amount numeric(18, 4) not null default 0,
  probability numeric(5, 2) not null default 10
    check (probability >= 0 and probability <= 100),
  expected_close_date date null,
  source text not null default 'ERP',
  notes text null,
  lost_reason text null,
  sync_status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_opportunities_stage_idx
  on public.crm_opportunities (stage);

create index if not exists crm_opportunities_customer_idx
  on public.crm_opportunities (customer_id);

create index if not exists crm_opportunities_expected_close_idx
  on public.crm_opportunities (expected_close_date);

comment on table public.crm_opportunities is 'Commercial opportunities / deals for CRM pipeline and booking conversion.';
comment on column public.crm_opportunities.customer_id is 'Nullable because early prospects may not have a fiscal/customer record yet.';
comment on column public.crm_opportunities.stage is 'Pipeline stage: NEW, CONTACTED, QUOTED, WON, LOST.';

-- Activity/booking links. The ERP may expose activities as crm_activities or activities depending on deployment.
alter table if exists public.crm_activities
  add column if not exists opportunity_id uuid null references public.crm_opportunities(id) on delete set null;

alter table if exists public.crm_activities
  add column if not exists linked_document_id uuid null;

alter table if exists public.crm_activities
  add column if not exists linked_document_type text null
    check (linked_document_type is null or linked_document_type in ('QUOTE', 'SALES_ORDER', 'INVOICE'));

alter table if exists public.crm_activities
  add column if not exists linked_document_display_id text null;

alter table if exists public.activities
  add column if not exists opportunity_id uuid null references public.crm_opportunities(id) on delete set null;

alter table if exists public.activities
  add column if not exists linked_document_id uuid null;

alter table if exists public.activities
  add column if not exists linked_document_type text null
    check (linked_document_type is null or linked_document_type in ('QUOTE', 'SALES_ORDER', 'INVOICE'));

alter table if exists public.activities
  add column if not exists linked_document_display_id text null;

-- Sales document back-reference to the booking/opportunity that generated it.
alter table if exists public.erp_sales_documents
  add column if not exists booking_activity_id uuid null;

alter table if exists public.erp_sales_documents
  add column if not exists opportunity_id uuid null references public.crm_opportunities(id) on delete set null;

-- Customer advance / unapplied receipt back-reference.
alter table if exists public.accounts_receivable_collections
  add column if not exists booking_activity_id uuid null;

alter table if exists public.accounts_receivable_collections
  add column if not exists opportunity_id uuid null references public.crm_opportunities(id) on delete set null;

-- Index optional integration tables only when the tables exist.
do $$
begin
  if to_regclass('public.crm_activities') is not null then
    create index if not exists crm_activities_opportunity_idx
      on public.crm_activities (opportunity_id);
  end if;

  if to_regclass('public.activities') is not null then
    create index if not exists activities_opportunity_idx
      on public.activities (opportunity_id);
  end if;

  if to_regclass('public.erp_sales_documents') is not null then
    create index if not exists erp_sales_documents_booking_activity_idx
      on public.erp_sales_documents (booking_activity_id);
    create index if not exists erp_sales_documents_opportunity_idx
      on public.erp_sales_documents (opportunity_id);
  end if;

  if to_regclass('public.accounts_receivable_collections') is not null then
    create index if not exists ar_collections_booking_activity_idx
      on public.accounts_receivable_collections (booking_activity_id);
    create index if not exists ar_collections_opportunity_idx
      on public.accounts_receivable_collections (opportunity_id);
  end if;
end $$;
