import { supabase, isSupabaseConfigured } from './supabase';
import { notificationService, NotificationEventType } from './notifications';

export class NotificationEvents {
  private static getClient() {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase is not configured.');
    }
    return supabase;
  }

  static async accountRegistered(userId: string, email: string): Promise<void> {
    const client = this.getClient();
    await notificationService.updatePreference('email', true).catch(() => {});
    await this.createInApp(client, userId, 'account_registered',
      'Welcome to hopNshop',
      `Your account (${email}) has been created. Sign in to start sourcing products.`,
      undefined, undefined, undefined, undefined);
  }

  static async emailVerified(userId: string, email: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'email_verified',
      'Email verified',
      `Your email address ${email} is now verified.`,
      undefined, undefined, undefined, undefined);
  }

  static async passwordReset(userId: string, email: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'password_reset',
      'Password reset requested',
      `A password reset link was sent to ${email}. If you did not request this, contact support.`,
      undefined, undefined, undefined, undefined);
  }

  static async sourcingRequestSubmitted(userId: string, sourcingRequestId: string, productName?: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'sourcing_request_submitted',
      'Sourcing request received',
      `Your sourcing request${productName ? ` for "${productName}"` : ''} has been received and is being reviewed.`,
      '/account/sourcing-requests', undefined, undefined, sourcingRequestId);
  }

  static async quotationCreated(userId: string, quotationId: string, quotationNumber: string, expiryDate?: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'quotation_created',
      'Your quotation is ready',
      `Quotation ${quotationNumber} is ready to review.${expiryDate ? ` Expires ${expiryDate}.` : ''}`,
      `/account/quotations/${quotationId}`, quotationId, undefined, undefined);
  }

  static async quotationExpiring(userId: string, quotationId: string, quotationNumber: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'quotation_expiring',
      'Quotation expiring soon',
      `Quotation ${quotationNumber} will expire soon. Accept or reject before it lapses.`,
      `/account/quotations/${quotationId}`, quotationId, undefined, undefined);
  }
  static async quotationAccepted(userId: string, quotationId: string, quotationNumber: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'quotation_accepted',
      'Quotation accepted',
      `You accepted quotation ${quotationNumber}. Your order is being processed.`,
      `/account/quotations/${quotationId}`, quotationId, undefined, undefined);
  }

  static async quotationRejected(userId: string, quotationId: string, quotationNumber: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'quotation_rejected',
      'Quotation rejected',
      `You rejected quotation ${quotationNumber}. You can request a revised quote.`,
      `/account/quotations/${quotationId}`, quotationId, undefined, undefined);
  }

  static async paymentConfirmed(userId: string, orderId: string, orderNumber: string, amount: number, currency: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'payment_confirmed',
      'Payment confirmed',
      `Your payment of ${currency.toUpperCase()} ${amount.toLocaleString()} for order ${orderNumber} has been confirmed.`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async paymentVerificationFailed(userId: string, orderId: string, orderNumber: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'payment_verification_failed',
      'Payment verification failed',
      `The payment for order ${orderNumber} could not be verified. Please submit a valid transaction reference.`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async orderConfirmed(userId: string, orderId: string, orderNumber: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'order_confirmed',
      'Order confirmed',
      `Your order ${orderNumber} has been confirmed and is being processed.`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async supplierUpdate(userId: string, orderId: string, orderNumber: string, message: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'supplier_update',
      'Supplier update',
      `Order ${orderNumber}: ${message}`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async shipmentUpdate(userId: string, orderId: string, orderNumber: string, status: string, trackingReference?: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'shipment_update',
      'Shipment update',
      `Order ${orderNumber} is now ${status.replaceAll('_', ' ')}.${trackingReference ? ` Tracking: ${trackingReference}` : ''}`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async orderReadyForCollection(userId: string, orderId: string, orderNumber: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'order_ready_for_collection',
      'Order ready for collection',
      `Your order ${orderNumber} is ready for collection.`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async orderDelivered(userId: string, orderId: string, orderNumber: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'order_delivered',
      'Order delivered',
      `Your order ${orderNumber} has been delivered.`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async orderCancelled(userId: string, orderId: string, orderNumber: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'order_cancelled',
      'Order cancelled',
      `Your order ${orderNumber} has been cancelled.`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async refundUpdate(userId: string, orderId: string, orderNumber: string, status: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'refund_update',
      'Refund update',
      `Refund for order ${orderNumber}: ${status.replaceAll('_', ' ')}.`,
      `/account/orders/${orderId}`, undefined, undefined, undefined);
  }

  static async adminAlert(userId: string, title: string, body: string, deepLink?: string): Promise<void> {
    const client = this.getClient();
    await this.createInApp(client, userId, 'admin_alert', title, body, deepLink, undefined, undefined, undefined);
  }

  private static async createInApp(
    client: ReturnType<typeof this.getClient>,
    userId: string,
    eventType: NotificationEventType,
    title: string,
    body: string,
    deepLink?: string,
    relatedOrderId?: string,
    relatedQuotationId?: string,
    relatedSourcingRequestId?: string
  ): Promise<void> {
    const idempotencyKey = `in_app_${eventType}_${userId}_${deepLink ?? title}_${Date.now()}`;

    const { error } = await client.from('notifications').insert({
      user_id: userId,
      title,
      body,
      channel: 'in_app',
      event_type: eventType,
      deep_link: deepLink ?? null,
      related_order_id: relatedOrderId ?? null,
      related_quotation_id: relatedQuotationId ?? null,
      related_sourcing_request_id: relatedSourcingRequestId ?? null,
      delivery_status: 'delivered',
    });

    if (error) throw error;

    try {
      await client.rpc('enqueue_notification', {
        p_user_id: userId,
        p_channel: 'in_app',
        p_event_type: eventType,
        p_recipient: userId,
        p_subject: title,
        p_body_text: body,
        p_body_html: null,
        p_payload: { deep_link: deepLink },
        p_idempotency_key: idempotencyKey,
      });
    } catch {
      // Non-fatal: the in-app notification is already persisted
    }
  }
}

export const notificationEvents = new NotificationEvents();