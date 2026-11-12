-- ============================================================================
-- hopNshop Notification System - Core Schema
-- Migration: 202611120003_notification_system.sql
-- Creates notification preferences, templates, queue, delivery log,
-- user device tokens, and extends the notifications table.
-- ============================================================================

-- Extend public.notifications with delivery and tracking columns
alter table public.notifications
  add column if not exists channel text not null default 'in_app'
    check (channel in ('in_app', 'email', 'sms', 'push'));

alter table public.notifications
  add column if not exists event_type text not null default 'system';

alter table public.notifications
  add column if not exists deep_link text;

alter table public.notifications
  add column if not exists provider_metadata jsonb not null default '{}';

alter table public.notifications
  add column if not exists delivery_status text not null default 'delivered'
    check (delivery_status in ('pending', 'sent', 'delivered', 'failed', 'suppressed'));

alter table public.notifications
  add column if not exists related_order_id uuid references public.orders(id) on delete set null;

alter table public.notifications
  add column if not exists related_quotation_id uuid references public.quotations(id) on delete set null;

alter table public.notifications
  add column if not exists related_sourcing_request_id uuid references public.sourcing_requests(id) on delete set null;

-- Notification preferences (per customer, channel + event opt-ins)
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'push', 'in_app')),
  enabled boolean not null default true,
  event_types text[] not null default '{}',
  consented_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel)
);

-- Notification templates (admin-managed)
create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  channel text not null check (channel in ('email', 'sms', 'push', 'in_app')),
  event_type text not null,
  subject text,
  body_html text,
  body_text text not null,
  variables jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Queued notifications awaiting delivery
create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'push', 'in_app')),
  event_type text not null,
  template_id uuid references public.notification_templates(id) on delete set null,
  recipient text not null,
  subject text,
  body_text text not null,
  body_html text,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'delivered', 'failed', 'suppressed')),
  scheduled_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text not null unique,
  provider_response jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz
);

-- Delivery attempt log (immutable record of each provider call)
create table if not exists public.notification_delivery_log (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.notification_queue(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'push', 'in_app')),
  provider text not null,
  status text not null check (status in ('sent', 'delivered', 'failed', 'timeout', 'suppressed')),
  provider_message_id text,
  error_code text,
  error_message text,
  request_payload jsonb,
  provider_response jsonb,
  created_at timestamptz not null default now()
);

-- User device tokens for push notifications (Capacitor + FCM)
create table if not exists public.user_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token text not null,
  platform text not null check (platform in ('android', 'ios', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_token)
);

-- Indexes
create index if not exists notifications_user_read_created_idx
  on public.notifications(user_id, read_at, created_at desc);

create index if not exists notifications_event_idx
  on public.notifications(event_type, created_at desc);

create index if not exists notifications_channel_status_idx
  on public.notifications(channel, delivery_status);

create index if not exists notifications_order_idx
  on public.notifications(related_order_id);

create index if not exists notifications_quotation_idx
  on public.notifications(related_quotation_id);

create index if not exists notifications_sourcing_idx
  on public.notifications(related_sourcing_request_id);

create index if not exists notification_preferences_user_idx
  on public.notification_preferences(user_id);

create index if not exists notification_templates_channel_event_idx
  on public.notification_templates(channel, event_type);

create index if not exists notification_queue_status_scheduled_idx
  on public.notification_queue(status, scheduled_at);

create index if not exists notification_queue_user_idx
  on public.notification_queue(user_id, created_at desc);

create index if not exists notification_queue_idempotency_idx
  on public.notification_queue(idempotency_key);

create index if not exists notification_delivery_log_queue_idx
  on public.notification_delivery_log(queue_id, created_at desc);

create index if not exists notification_delivery_log_provider_idx
  on public.notification_delivery_log(provider, created_at desc);

create index if not exists user_device_tokens_user_idx
  on public.user_device_tokens(user_id);

-- RLS: enable on all new tables
alter table public.notification_preferences enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_queue enable row level security;
alter table public.notification_delivery_log enable row level security;
alter table public.user_device_tokens enable row level security;

-- RLS policies: notifications (extend existing)
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- RLS policies: notification_preferences
create policy "own notification preferences" on public.notification_preferences
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- RLS policies: notification_templates (read all, write admin only)
create policy "read notification templates" on public.notification_templates
  for select using (true);

create policy "admin manage notification templates" on public.notification_templates
  for all using (public.is_admin())
  with check (public.is_admin());

-- RLS policies: notification_queue
create policy "own notification queue" on public.notification_queue
  for select using (user_id = auth.uid() or public.is_admin());

create policy "service role manage queue" on public.notification_queue
  for all using (true) with check (true);

-- RLS policies: notification_delivery_log
create policy "own notification delivery log" on public.notification_delivery_log
  for select using (
    exists (
      select 1 from public.notification_queue q
      where q.id = notification_delivery_log.queue_id
        and (q.user_id = auth.uid() or public.is_admin())
    )
  );

create policy "service role manage delivery log" on public.notification_delivery_log
  for all using (true) with check (true);

-- RLS policies: user_device_tokens
create policy "own device tokens" on public.user_device_tokens
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Helper function: get customer contact details (email + phone)
create or replace function public.get_customer_contact(p_user_id uuid)
returns table (email text, phone text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_phone text;
begin
  select u.email into v_email
    from auth.users u where u.id = p_user_id;

  select p.phone into v_phone
    from public.profiles p where p.id = p_user_id;

  return query select v_email, v_phone;
end;
$$;

revoke all on function public.get_customer_contact(uuid) from public;
grant execute on function public.get_customer_contact(uuid) to authenticated;

-- Helper function: render template variables
create or replace function public.render_template(template_body text, vars jsonb)
returns text
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  result text := template_body;
  key text;
  val text;
begin
  for key in select * from jsonb_object_keys(vars) loop
    select vars->>key into val;
    result := replace(result, '{{' || key || '}}', coalesce(val, ''));
  end loop;
  return result;
end;
$$;

revoke all on function public.render_template(text, jsonb) from public;
grant execute on function public.render_template(text, jsonb) to authenticated, anon;

-- ============================================================================
-- End of migration
-- ============================================================================