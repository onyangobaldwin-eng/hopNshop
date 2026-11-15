import { supabase, isSupabaseConfigured } from './supabase';

export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'push';
export type NotificationDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'suppressed';
export type NotificationEventType =
  | 'account_registered'
  | 'email_verified'
  | 'password_reset'
  | 'sourcing_request_submitted'
  | 'quotation_created'
  | 'quotation_expiring'
  | 'quotation_accepted'
  | 'quotation_rejected'
  | 'payment_confirmed'
  | 'payment_verification_failed'
  | 'order_confirmed'
  | 'order_procurement_update'
  | 'supplier_update'
  | 'shipment_update'
  | 'delivery_update'
  | 'order_ready_for_collection'
  | 'order_delivered'
  | 'order_cancelled'
  | 'refund_update'
  | 'admin_alert'
  | 'system';

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  event_type: NotificationEventType;
  deep_link?: string | null;
  provider_metadata: Record<string, unknown>;
  delivery_status: NotificationDeliveryStatus;
  related_order_id?: string | null;
  related_quotation_id?: string | null;
  related_sourcing_request_id?: string | null;
  read_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  channel: NotificationChannel;
  enabled: boolean;
  event_types: string[];
  consented_at: string;
  updated_at: string;
}

export interface NotificationQueueItem {
  id: string;
  user_id: string;
  channel: NotificationChannel;
  event_type: string;
  recipient: string;
  subject?: string | null;
  body_text: string;
  body_html?: string | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'failed' | 'suppressed';
  attempts: number;
  max_attempts: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  delivered_at?: string | null;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: NotificationChannel;
  event_type: string;
  subject?: string | null;
  body_html?: string | null;
  body_text: string;
  variables: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

class NotificationService {
  private getClient() {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    }
    return supabase;
  }

  async listNotifications(limit = 50): Promise<Notification[]> {
    const client = this.getClient();
    const { data, error } = await client
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as Notification[];
  }

  async listUnreadNotifications(): Promise<Notification[]> {
    const client = this.getClient();
    const { data, error } = await client
      .from('notifications')
      .select('*')
      .is('read_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Notification[];
  }

  async getUnreadCount(): Promise<number> {
    const client = this.getClient();
    const { count, error } = await client
      .from('notifications')
      .select('*', { head: true, count: 'exact' })
      .is('read_at', null);
    if (error) throw error;
    return count ?? 0;
  }

  async markAsRead(notificationId: string): Promise<void> {
    const client = this.getClient();
    const { error } = await client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId);
    if (error) throw error;
  }

  async markAllAsRead(): Promise<void> {
    const client = this.getClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await client.rpc('mark_all_notifications_read', { p_user_id: user.id });
    if (error) throw error;
  }

  async listPreferences(): Promise<NotificationPreference[]> {
    const client = this.getClient();
    const { data, error } = await client
      .from('notification_preferences')
      .select('*')
      .order('channel');
    if (error) throw error;
    return (data ?? []) as NotificationPreference[];
  }

  async updatePreference(channel: NotificationChannel, enabled: boolean, eventTypes?: string[]): Promise<void> {
    const client = this.getClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await client
      .from('notification_preferences')
      .upsert({
        user_id: user.id,
        channel,
        enabled,
        event_types: eventTypes ?? [],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id, channel' });
    if (error) throw error;
  }

  async listQueue(limit = 100): Promise<NotificationQueueItem[]> {
    const client = this.getClient();
    const { data, error } = await client
      .from('notification_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as NotificationQueueItem[];
  }

  async retryFailed(queueId: string): Promise<void> {
    const client = this.getClient();
    const { error } = await client
      .from('notification_queue')
      .update({
        status: 'pending',
        error_code: null,
        error_message: null,
        updated_at: new Date().toISOString(),
        scheduled_at: new Date().toISOString(),
      })
      .eq('id', queueId)
      .in('status', ['failed', 'suppressed']);
    if (error) throw error;
  }

  async listTemplates(): Promise<NotificationTemplate[]> {
    const client = this.getClient();
    const { data, error } = await client
      .from('notification_templates')
      .select('*')
      .order('channel')
      .order('event_type');
    if (error) throw error;
    return (data ?? []) as NotificationTemplate[];
  }

  async upsertTemplate(template: Partial<NotificationTemplate> & { name: string; channel: NotificationChannel; event_type: string; body_text: string }): Promise<void> {
    const client = this.getClient();
    const { error } = await client
      .from('notification_templates')
      .upsert(template, { onConflict: 'name' });
    if (error) throw error;
  }

  async getDeliveryStats(): Promise<Record<string, number>> {
    const client = this.getClient();
    const { data, error } = await client
      .from('notification_queue')
      .select('status')
      .not('status', 'eq', 'pending');
    if (error) throw error;
    const stats: Record<string, number> = {};
    for (const row of (data ?? [])) {
      stats[row.status] = (stats[row.status] ?? 0) + 1;
    }
    return stats;
  }

  async registerDeviceToken(deviceToken: string, platform: 'android' | 'ios' | 'web'): Promise<void> {
    const client = this.getClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await client
      .from('user_device_tokens')
      .upsert({
        user_id: user.id,
        device_token: deviceToken,
        platform,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id, device_token' });
    if (error) throw error;
  }
}

export const notificationService = new NotificationService();

export const EVENT_LABELS: Record<NotificationEventType, string> = {
  account_registered: 'Account registered',
  email_verified: 'Email verified',
  password_reset: 'Password reset',
  sourcing_request_submitted: 'Sourcing request submitted',
  quotation_created: 'Quotation created',
  quotation_expiring: 'Quotation expiring',
  quotation_accepted: 'Quotation accepted',
  quotation_rejected: 'Quotation rejected',
  payment_confirmed: 'Payment confirmed',
  payment_verification_failed: 'Payment verification failed',
  order_confirmed: 'Order confirmed',
  order_procurement_update: 'Procurement update',
  supplier_update: 'Supplier update',
  shipment_update: 'Shipment update',
  delivery_update: 'Delivery update',
  order_ready_for_collection: 'Order ready for collection',
  order_delivered: 'Order delivered',
  order_cancelled: 'Order cancelled',
  refund_update: 'Refund update',
  admin_alert: 'Administrative alert',
  system: 'System notification',
};

export const CATEGORY_LABELS: Record<string, string> = {
  account_registered: 'Account',
  email_verified: 'Account',
  password_reset: 'Account',
  sourcing_request_submitted: 'Sourcing',
  quotation_created: 'Quotation',
  quotation_expiring: 'Quotation',
  quotation_accepted: 'Quotation',
  quotation_rejected: 'Quotation',
  payment_confirmed: 'Payment',
  payment_verification_failed: 'Payment',
  order_confirmed: 'Order',
  order_procurement_update: 'Order',
  supplier_update: 'Supplier',
  shipment_update: 'Shipment',
  delivery_update: 'Shipment',
  order_ready_for_collection: 'Order',
  order_delivered: 'Order',
  order_cancelled: 'Order',
  refund_update: 'Refund',
  admin_alert: 'Admin',
  system: 'System',
};

export function isSimulatedStatus(status: string): boolean {
  return status === 'simulated';
}