import { useCallback, useEffect, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonIcon,
  IonList, IonItem, IonLabel, IonBadge, IonButtons, IonMenuButton, IonCheckbox,
  IonSpinner, IonText, IonSegment, IonSegmentButton, IonToggle, IonBackButton
} from '@ionic/react';
import { chevronForwardOutline, checkboxOutline, checkmarkDoneOutline, settingsOutline } from 'ionicons/icons';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { notificationService, Notification, NotificationPreference, EVENT_LABELS, CATEGORY_LABELS } from '../lib/notifications';
import { Capacitor } from '@capacitor/core';
import { registerNativePushNotifications } from '../lib/nativeApp';

interface NotificationCentreProps {
  userId: string;
  onClose?: () => void;
}

const CHANNEL_COLORS: Record<string, string> = {
  in_app: '#6c757d',
  email: '#0d6efd',
  sms: '#20c997',
  push: '#6610f2',
};

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function CustomerNotificationCentre({ userId, onClose }: NotificationCentreProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'category'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [prefModalOpen, setPrefModalOpen] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState('');

  const loadNotifications = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const list = (data ?? []) as Notification[];
      setNotifications(list);
      setUnreadCount(list.filter(n => !n.read_at).length);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, supabase]);

  const loadPreferences = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId);
      if (error) throw error;
      setPreferences((data ?? []) as NotificationPreference[]);
    } catch (err) {
      console.error('Failed to load preferences:', err);
    }
  }, [userId, supabase]);

  const markAsRead = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      setNotifications(notifications.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      setUnreadCount(Math.max(0, unreadCount - 1));
    }
  };

  const markAllAsRead = async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc('mark_all_notifications_read', { p_user_id: userId });
    if (!error) {
      setNotifications(notifications.map(n => ({ ...n, read_at: new Date().toISOString() })));
      setUnreadCount(0);
    }
  };

  const togglePreference = async (pref: NotificationPreference) => {
    if (!supabase) return;
    setPreferenceMessage('');
    const { error } = await supabase
      .from('notification_preferences')
      .update({ enabled: pref.enabled, updated_at: new Date().toISOString() })
      .eq('id', pref.id);
    if (error) {
      console.error('Notification preference could not be updated.', error.message);
      setPreferenceMessage('Your notification preference could not be saved. Please try again.');
      return;
    }
    setPreferences(preferences.map(p => p.id === pref.id ? { ...p, enabled: pref.enabled } : p));
    if (pref.channel === 'push' && pref.enabled) await enablePushOnDevice();
  };

  const enablePushOnDevice = async () => {
    if (!Capacitor.isNativePlatform()) return;
    setPreferenceMessage('');
    try {
      await registerNativePushNotifications(userId, true);
      setPreferenceMessage('Device registration was requested. Push delivery still depends on Firebase setup and a successful token sync.');
    } catch (error) {
      console.error('Android push notification setup could not be completed.', error);
      setPreferenceMessage('Push could not be enabled on this device. Check notification permission and Firebase setup.');
    }
  };

  useEffect(() => {
    loadNotifications();
    loadPreferences();
  }, [loadNotifications, loadPreferences]);

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read_at;
    if (filter === 'category' && categoryFilter) {
      return CATEGORY_LABELS[n.event_type] === categoryFilter;
    }
    return true;
  });

  const categories = Array.from(new Set(notifications.map(n => CATEGORY_LABELS[n.event_type]))).sort();

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>Notifications</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setPrefModalOpen(true)} color="medium" size="small">
              <IonIcon slot="icon-only" icon={settingsOutline} />
            </IonButton>
            {onClose && <IonButton onClick={onClose} color="medium" size="small">Close</IonButton>}
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <div className="notification-centre">
          <div className="header-section">
            <h1>Notification Centre</h1>
            <p>Stay up to date with your hopNshop orders, quotations, and account activity.</p>
          </div>

          {unreadCount > 0 && (
            <div className="unread-banner">
              <IonBadge color="danger">{unreadCount} unread</IonBadge>{' '}
              <IonButton color="primary" size="small" fill="clear" onClick={markAllAsRead}>
                Mark all as read
              </IonButton>
            </div>
          )}

          <div className="filter-bar">
            <IonSegment value={filter} onIonChange={(e) => setFilter((e.target as any).value as any)}>
              <IonSegmentButton value="all">All</IonSegmentButton>
              <IonSegmentButton value="unread">Unread</IonSegmentButton>
              <IonSegmentButton value="category">Categories</IonSegmentButton>
            </IonSegment>
          </div>

          {categories.length > 0 && filter === 'category' && (
            <div className="category-tabs">
              {categories.map(cat => (
                <button
                  key={cat}
                  className={`category-pill ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => { setCategoryFilter(cat); }}
                >
                  {cat}
                </button>
              ))}
              <button
                key="all-categories"
                className={`category-pill ${categoryFilter === '' ? 'active' : ''}`}
                onClick={() => setCategoryFilter('')}
              >
                All
              </button>
            </div>
          )}

          {loading ? (
            <div className="loading"><IonSpinner /></div>
          ) : filteredNotifications.length === 0 ? (
            <div className="empty-state">
              <p>No notifications yet.</p>
            </div>
          ) : (
            <IonList lines="none">
              {filteredNotifications.map(n => (
                <IonItem
                  key={n.id}
                  className={`notification-item ${!n.read_at ? 'unread' : 'read'}`}
                  button
                  onClick={() => { if (!n.read_at) void markAsRead(n.id); }}
                >
                  <IonCheckbox slot="start" checked={!!n.read_at} onChange={() => void markAsRead(n.id)} />
                  <div className="notification-content">
                    <div className="notification-header">
                      <span className="channel-badge" style={{ backgroundColor: CHANNEL_COLORS[n.channel] }}>
                        {n.channel}
                      </span>
                      <span className="event-label">{EVENT_LABELS[n.event_type as keyof typeof EVENT_LABELS] ?? n.event_type}</span>
                      <span className="time">{relativeTime(n.created_at)}</span>
                    </div>
                    <h3 className="notification-title">{n.title}</h3>
                    <p className="notification-body">{n.body}</p>
                    {n.deep_link && (
                      <div className="deep-link">
                        <IonIcon slot="start" icon={chevronForwardOutline} size="small" />
                        {n.deep_link}
                      </div>
                    )}
                  </div>
                  <IonIcon slot="end" icon={!n.read_at ? checkboxOutline : checkmarkDoneOutline} />
                </IonItem>
              ))}
            </IonList>
          )}
        </div>
      </IonContent>

        <IonModal isOpen={prefModalOpen} onDidDismiss={() => setPrefModalOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Notification Preferences</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setPrefModalOpen(false)}>Done</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <IonList lines="full">
              <IonItem>
                <IonLabel>In-app notifications</IonLabel>
                <IonToggle slot="end" checked={preferences.find(p => p.channel === 'in_app')?.enabled ?? true} onChange={(e) => void togglePreference({ ...preferences.find(p => p.channel === 'in_app')!, enabled: (e.target as any).checked })} />
              </IonItem>
              <IonItem>
                <IonLabel>Email notifications</IonLabel>
                <IonToggle slot="end" checked={preferences.find(p => p.channel === 'email')?.enabled ?? true} onChange={(e) => void togglePreference({ ...preferences.find(p => p.channel === 'email')!, enabled: (e.target as any).checked })} />
              </IonItem>
              <IonItem>
                <IonLabel>SMS notifications</IonLabel>
                <IonToggle slot="end" checked={preferences.find(p => p.channel === 'sms')?.enabled ?? false} onChange={(e) => void togglePreference({ ...preferences.find(p => p.channel === 'sms')!, enabled: (e.target as any).checked })} />
                <IonText color="medium" slot="end" style={{ fontSize: '0.875rem' }}>
                  SMS requires opt-in. Message and data rates may apply.
                </IonText>
              </IonItem>
              <IonItem>
                <IonLabel>Push notifications</IonLabel>
                <IonToggle slot="end" checked={preferences.find(p => p.channel === 'push')?.enabled ?? true} onChange={(e) => void togglePreference({ ...preferences.find(p => p.channel === 'push')!, enabled: (e.target as any).checked })} />
                {Capacitor.isNativePlatform() && (preferences.find(p => p.channel === 'push')?.enabled ?? true) && <IonButton size="small" fill="clear" onClick={() => void enablePushOnDevice()}>Enable on this device</IonButton>}
              </IonItem>
            </IonList>
            {preferenceMessage && <IonText color="medium"><p role="status">{preferenceMessage}</p></IonText>}
          </IonContent>
        </IonModal>

      </IonPage>
    );
  }