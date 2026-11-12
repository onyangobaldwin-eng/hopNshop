import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface CaseRow { id: string; subject: string; message: string; status: string; staff_response: string | null; created_at: string; user_id: string; }
interface NotificationRow { id: string; title: string; body: string; read_at: string | null; created_at: string; }

function CustomerHelpdesk({ userId, isStaff }: { userId: string; isStaff: boolean }) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const [caseResult, notificationResult] = await Promise.all([
      supabase.from('support_cases').select('id,subject,message,status,staff_response,created_at,user_id').order('created_at', { ascending: false }),
      supabase.from('notifications').select('id,title,body,read_at,created_at').eq('user_id', userId).order('created_at', { ascending: false })
    ]);
    if (caseResult.error) console.error('Support cases could not be loaded.', caseResult.error.message);
    else setCases((caseResult.data ?? []) as CaseRow[]);
    if (notificationResult.error) console.error('Notifications could not be loaded.', notificationResult.error.message);
    else setNotifications((notificationResult.data ?? []) as NotificationRow[]);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const submitCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const subject = String(form.get('subject') ?? '').trim();
    const body = String(form.get('caseMessage') ?? '').trim();
    if (subject.length < 4 || subject.length > 160 || body.length < 10 || body.length > 3000) { setMessage('Add a subject and a message between 10 and 3,000 characters.'); return; }
    const { error } = await supabase.from('support_cases').insert({ user_id: userId, subject, message: body });
    if (error) { console.error('Support request could not be submitted.', error.message); setMessage('We could not send your support request. Please try again.'); return; }
    formElement.reset();
    setMessage('Your support request was sent.');
    await load();
  };

  const notifyAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !isStaff) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const recipient = String(form.get('recipient') ?? '').trim();
    const title = String(form.get('notificationTitle') ?? '').trim();
    const body = String(form.get('notificationBody') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipient) || title.length < 2 || title.length > 120 || body.length < 2 || body.length > 1000) { setMessage('Provide a valid customer ID, short title, and message.'); return; }
    const { error } = await supabase.from('notifications').insert({ user_id: recipient, title, body });
    if (error) { console.error('Customer notification could not be sent.', error.message); setMessage('The notification could not be saved. Check the customer ID and admin access.'); return; }
    formElement.reset(); setMessage('In-app notification added to the customer account.');
  };

  const updateCase = async (supportCase: CaseRow, status: string, staffResponse: string) => {
    if (!supabase || !isStaff) return;
    const nextResponse = staffResponse.trim() || null;
    const { error } = await supabase.from('support_cases').update({ status, staff_response: nextResponse, updated_at: new Date().toISOString(), closed_at: status === 'resolved' || status === 'closed' ? new Date().toISOString() : null }).eq('id', supportCase.id);
    if (error) { console.error('Support case could not be updated.', error.message); setMessage('The support case could not be updated.'); return; }
    await load();
  };

  const markRead = async (notification: NotificationRow) => {
    if (!supabase || notification.read_at) return;
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notification.id).eq('user_id', userId);
    if (error) { console.error('Notification could not be marked read.', error.message); return; }
    setNotifications(rows => rows.map(row => row.id === notification.id ? { ...row, read_at: new Date().toISOString() } : row));
  };

  return <section className="account-section"><h3>Help and updates</h3>
    <h4>Notifications</h4>{notifications.length ? notifications.map(note => <article className="account-card" key={note.id}><div className="account-card-heading"><strong>{note.title}</strong><span>{note.read_at ? 'Read' : 'New'}</span></div><p>{note.body}</p>{!note.read_at && <button className="text-button" type="button" onClick={() => void markRead(note)}>Mark as read</button>}</article>) : <p className="account-empty">No updates yet.</p>}
    <h4>Your support requests</h4>{cases.filter(item => item.user_id === userId).map(item => <article className="account-card" key={item.id}><div className="account-card-heading"><strong>{item.subject}</strong><span>{item.status.replaceAll('_', ' ')}</span></div><p>{item.message}</p>{item.staff_response && <p className="checkout-notice">Team response: {item.staff_response}</p>}</article>)}
    <form onSubmit={submitCase}><label>Subject<input name="subject" required minLength={4} maxLength={160} /></label><label>How can we help?<textarea name="caseMessage" required minLength={10} maxLength={3000} /></label><button className="button button-dark" type="submit">Send support request</button></form>
    {isStaff && <><h4>Support queue</h4>{cases.map(item => <article className="admin-request" key={item.id}><div className="account-card-heading"><strong>{item.subject}</strong><span>{item.status}</span></div><small>Customer {item.user_id}</small><p>{item.message}</p><label>Response<textarea maxLength={2000} defaultValue={item.staff_response ?? ''} id={`support-response-${item.id}`} /></label><label>Status<select defaultValue={item.status} id={`support-status-${item.id}`}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_customer">Waiting for customer</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><button type="button" className="text-button" onClick={() => { const status = document.getElementById(`support-status-${item.id}`) as HTMLSelectElement | null; const response = document.getElementById(`support-response-${item.id}`) as HTMLTextAreaElement | null; if (status && response) void updateCase(item, status.value, response.value); }}>Save response</button></article>)}<h4>Send an in-app notification</h4><form onSubmit={notifyAdmin}><label>Customer user ID<input name="recipient" required /></label><label>Title<input name="notificationTitle" required maxLength={120} /></label><label>Message<textarea name="notificationBody" required maxLength={1000} /></label><button className="button button-dark" type="submit">Add notification</button></form></>}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}

export default CustomerHelpdesk;
