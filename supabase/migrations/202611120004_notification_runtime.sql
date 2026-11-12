-- ============================================================================
-- hopNshop Notification System - Runtime Functions
-- Migration: 202611120004_notification_runtime.sql
-- Adds helper functions for queue processing, preference defaults,
-- and notification creation triggers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Default notification preferences for new users
-- ----------------------------------------------------------------------------
create or replace function public.ensure_default_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notification_preferences (user_id, channel, enabled, event_types)
  values
    (new.id, 'in_app', true, '{}'),
    (new.id, 'email', true, '{}'),
    (new.id, 'sms', false, '{}'),
    (new.id, 'push', true, '{}')
  on conflict (user_id, channel) do nothing;
  return new;
end;
$$;

create trigger ensure_default_preferences_trigger
  after insert on auth.users
  for each row execute function public.ensure_default_notification_preferences();

-- ----------------------------------------------------------------------------
-- Helper: enqueue a notification for delivery
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_notification(
  p_user_id uuid,
  p_channel text,
  p_event_type text,
  p_recipient text,
  p_subject text,
  p_body_text text,
  p_body_html text,
  p_payload jsonb,
  p_idempotency_key text,
  p_template_id uuid default null,
  p_scheduled_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queue_id uuid;
begin
  -- Idempotency: if a queue entry with this key already exists, return it
  select id into v_queue_id
    from public.notification_queue
    where idempotency_key = p_idempotency_key;

  if v_queue_id is not null then
    return v_queue_id;
  end if;

  insert into public.notification_queue (
    user_id, channel, event_type, template_id, recipient,
    subject, body_text, body_html, payload, idempotency_key, scheduled_at
  )
  values (
    p_user_id, p_channel, p_event_type, p_template_id, p_recipient,
    p_subject, p_body_text, p_body_html, p_payload, p_idempotency_key, p_scheduled_at
  )
  returning id into v_queue_id;

  return v_queue_id;
end;
$$;

revoke all on function public.enqueue_notification(uuid, text, text, text, text, text, text, jsonb, text, uuid, timestamptz) from public;
grant execute on function public.enqueue_notification(uuid, text, text, text, text, text, text, jsonb, text, uuid, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- Helper: create an in-app notification record (immediate, visible in app)
-- ----------------------------------------------------------------------------
create or replace function public.create_in_app_notification(
  p_user_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_deep_link text default null,
  p_related_order_id uuid default null,
  p_related_quotation_id uuid default null,
  p_related_sourcing_request_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notification_id uuid;
begin
  insert into public.notifications (
    user_id, title, body, channel, event_type, deep_link,
    related_order_id, related_quotation_id, related_sourcing_request_id,
    delivery_status
  )
  values (
    p_user_id, p_title, p_body, 'in_app', p_event_type, p_deep_link,
    p_related_order_id, p_related_quotation_id, p_related_sourcing_request_id,
    'delivered'
  )
  returning id into v_notification_id;

  -- Also enqueue an in-app queue record for delivery tracking
  perform public.enqueue_notification(
    p_user_id, 'in_app', p_event_type, p_user_id::text,
    p_title, p_body, null, '{}',
    'in_app_' || p_event_type || '_' || p_user_id::text || '_' || now()::text,
    null, now()
  );

  return v_notification_id;
end;
$$;

revoke all on function public.create_in_app_notification(uuid, text, text, text, text, uuid, uuid, uuid) from public;
grant execute on function public.create_in_app_notification(uuid, text, text, text, text, uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Helper: mark all notifications as read for a user
-- ----------------------------------------------------------------------------
create or replace function public.mark_all_notifications_read(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = p_user_id and read_at is null;
end;
$$;

revoke all on function public.mark_all_notifications_read(uuid) from public;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- ============================================================================
-- End of migration
-- ============================================================================