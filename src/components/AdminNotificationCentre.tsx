import { useCallback, useEffect, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonIcon,
  IonList, IonItem, IonLabel, IonBadge, IonButtons, IonMenuButton, IonSpinner,
  IonText, IonSegment, IonSegmentButton, IonInput, IonSelect, IonSelectOption,
  IonChip, IonGrid, IonRow, IonCol
} from '@ionic/react';
import { chevronForwardOutline, refreshOutline, alertCircleOutline, settingsOutline, playOutline, documentTextOutline } from 'ionicons/icons';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AdminNotificationCentreProps {
  onClose?: () => void;
}

type QueueStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'failed' | 'suppressed';

interface QueueItem {
  id: string;
  user_id: string;
  channel: string;
  event_type: string;
  recipient: string;
  subject?: string | null;
  body_text: string;
  status: QueueStatus;
  attempts: number;
  max_attempts: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  delivered_at?: string | null;
  provider_response?: any;
}

interface Template {
  id: string;
  name: string;
  channel: string;
  event_type: string;
  subject?: string | null;
  body_text: string;
  active: boolean;
  created_at: string;
}

interface ProviderStatus {
  name: string;
  channel: string;
  configured: boolean;
  credential: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#ffc107',
  sending: '#17a2b8',
  sent: '#20c997',
  delivered: '#0d6efd',
  failed: '#dc3545',
  suppressed: '#6c757d',
};

export default function AdminNotificationCentre({ onClose }: AdminNotificationCentreProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | QueueStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [qRes, tRes, pRes] = await Promise.all([
        supabase.from('notification_queue').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('notification_templates').select('*').order('name'),
        supabase.from('notification_queue').select('status'),
      ]);

      if (qRes.error) throw qRes.error;
      if (tRes.error) throw tRes.error;
      if (pRes.error) throw pRes.error;

      setQueue((qRes.data ?? []) as QueueItem[]);
      setTemplates((tRes.data ?? []) as Template[]);

      const statusCounts: Record<string, number> = {};
      for (const row of (pRes.data ?? [])) {
        statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
      }
      setStats(statusCounts);

      setProviders([
        {
          name: 'Resend (Email)',
          channel: 'email',
          configured: typeof Deno !== 'undefined' && !!Deno.env.get('RESEND_API_KEY'),
          credential: 'RESEND_API_KEY',
        },
        {
          name: "Africa's Talking (SMS)",
          channel: 'sms',
          configured: typeof Deno !== 'undefined' && !!Deno.env.get('AFRICASTALKING_API_KEY'),
          credential: 'AFRICASTALKING_API_KEY',
        },
        {
          name: 'Firebase (Push)',
          channel: 'push',
          configured: typeof Deno !== 'undefined' && !!Deno.env.get('FIREBASE_SERVICE_ACCOUNT'),
          credential: 'FIREBASE_SERVICE_ACCOUNT',
        },
      ]);
    } catch (err) {
      console.error('Failed to load admin notification data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const retryFailed = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('notification_queue')
      .update({
        status: 'pending',
        error_code: null,
        error_message: null,
        updated_at: new Date().toISOString(),
        scheduled_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['failed', 'suppressed']);
    if (!error) {
      setQueue(queue.map(q => q.id === id ? { ...q, status: 'pending' } : q));
    }
  };

  const filteredQueue = queue.filter(q => {
    if (statusFilter !== 'all') return q.status === statusFilter;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return q.recipient.toLowerCase().includes(term) ||
        q.event_type.toLowerCase().includes(term) ||
        (q.subject ?? '').toLowerCase().includes(term);
    }
    return true;
  });

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Notification Management</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => void loadData()} color="medium" size="small">
              <IonIcon slot="icon-only" icon={refreshOutline} />
            </IonButton>
            {onClose && <IonButton onClick={onClose} color="medium" size="small">Close</IonButton>}
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <div className="admin-notification-centre">
          <div className="header-section">
            <h1>Notification Management</h1>
            <p>Monitor delivery history, retry failures, and manage templates.</p>
          </div>

          <div className="stats-grid">
            {Object.entries(stats).map(([status, count]) => (
              <div key={status} className="stat-card">
                <IonBadge color={STATUS_COLORS[status] as any || 'medium'}>
                  {status}
                </IonBadge>
                <span className="stat-value">{count}</span>
              </div>
            ))}
          </div>

          <div className="provider-section">
            <h3>Provider Configuration</h3>
            <IonList lines="full">
              {providers.map(p => (
                <IonItem key={p.name}>
                  <IonLabel>
                    <h3>{p.name}</h3>
                    <p>{p.channel.toUpperCase()} · {p.credential}</p>
                  </IonLabel>
                  <IonBadge slot="end" color={p.configured ? 'success' : 'warning'}>
                    {p.configured ? 'Configured' : 'Not configured'}
                  </IonBadge>
                </IonItem>
              ))}
              {providers.some(p => !p.configured) && (
                <IonItem>
                  <IonLabel color="warning">
                    Some providers are not configured. Notifications will be simulated (not actually delivered) until credentials are set in Supabase Edge Function secrets.
                  </IonLabel>
                </IonItem>
              )}
            </IonList>
          </div>

          <div className="filter-section">
            <IonSegment value={statusFilter} onIonChange={(e) => setStatusFilter((e.target as any).value as any)}>
              <IonSegmentButton value="all">All</IonSegmentButton>
              <IonSegmentButton value="pending">Pending</IonSegmentButton>
              <IonSegmentButton value="sent">Sent</IonSegmentButton>
              <IonSegmentButton value="delivered">Delivered</IonSegmentButton>
              <IonSegmentButton value="failed">Failed</IonSegmentButton>
              <IonSegmentButton value="suppressed">Suppressed</IonSegmentButton>
            </IonSegment>
            <IonInput
              placeholder="Search recipient, event, or subject..."
              value={searchTerm}
              onIonChange={(e) => setSearchTerm(e.detail.value ?? '')}
              clearInput
            />
          </div>

          <h3>Notification Queue ({filteredQueue.length})</h3>
          {loading ? (
            <div className="loading"><IonSpinner /></div>
          ) : filteredQueue.length === 0 ? (
            <div className="empty-state"><p>No notifications in queue.</p></div>
          ) : (
            <IonList lines="full">
              {filteredQueue.map(q => (
                <IonItem key={q.id} className="queue-item">
                  <IonLabel>
                    <h3>{q.subject ?? '(no subject)'}</h3>
                    <p>{q.recipient} · {q.event_type} · {q.channel}</p>
                    <p>{q.body_text}</p>
                  </IonLabel>
                  <IonBadge slot="end" color={STATUS_COLORS[q.status] as any || 'medium'}>
                    {q.status} ({q.attempts}/{q.max_attempts})
                  </IonBadge>
                  {(q.status === 'failed' || q.status === 'suppressed') && (
                    <IonButton slot="end" size="small" fill="outline" color="danger" onClick={() => void retryFailed(q.id)}>
                      Retry
                    </IonButton>
                  )}
                  {q.error_message && (
                    <IonText color="danger" slot="end" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
                      {q.error_code}: {q.error_message}
                    </IonText>
                  )}
                </IonItem>
              ))}
            </IonList>
          )}

          <div className="templates-section">
            <h3>Message Templates</h3>
            <IonList lines="full">
              {templates.map(t => (
                <IonItem key={t.id}>
                  <IonLabel>
                    <h3>{t.name}</h3>
                    <p>{t.channel} · {t.event_type} · {t.active ? 'Active' : 'Inactive'}</p>
                    <p>{t.body_text}</p>
                  </IonLabel>
                </IonItem>
              ))}
            </IonList>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}