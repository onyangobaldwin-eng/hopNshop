import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { customerProfileSchema, savedAddressSchema } from '../lib/domain';
import { supabase } from '../lib/supabase';

interface Address {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  address_line: string;
  city: string;
  county: string | null;
  is_default: boolean;
  used_by_order: boolean;
}

interface CustomerProfileProps {
  userId: string;
}

function CustomerProfile({ userId }: CustomerProfileProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [editing, setEditing] = useState<Address | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError('Profile services are not configured.');
      return;
    }

    setLoading(true);
    setError('');
    const [profileResult, addressResult, orderResult] = await Promise.all([
      supabase.from('profiles').select('full_name,phone').eq('id', userId).maybeSingle(),
      supabase.from('addresses').select('id,label,recipient_name,phone,address_line,city,county,is_default').eq('user_id', userId).order('is_default', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('orders').select('address_id').eq('user_id', userId).not('address_id', 'is', null)
    ]);
    const loadError = profileResult.error ?? addressResult.error ?? orderResult.error;
    if (loadError) {
      console.error('Customer profile could not be loaded.', loadError.message);
      setError('Profile information could not be loaded. Please try again.');
      setLoading(false);
      return;
    }

    const usedAddressIds = new Set((orderResult.data ?? []).map(order => order.address_id).filter((id): id is string => Boolean(id)));
    setName(profileResult.data?.full_name ?? '');
    setPhone(profileResult.data?.phone ?? '');
    setAddresses(((addressResult.data ?? []) as Omit<Address, 'used_by_order'>[]).map(address => ({
      ...address,
      used_by_order: usedAddressIds.has(address.id)
    })));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    const parsed = customerProfileSchema.safeParse({ fullName: name, phone });
    if (!parsed.success) {
      setMessage('Check your name and phone number.');
      return;
    }
    if (!supabase) {
      setMessage('Profile services are not configured.');
      return;
    }

    setBusy(true);
    const { error: saveError } = await supabase.from('profiles').upsert({
      id: userId,
      full_name: parsed.data.fullName || null,
      phone: parsed.data.phone || null,
      updated_at: new Date().toISOString()
    });
    setBusy(false);
    if (saveError) {
      console.error('Customer profile could not be saved.', saveError.message);
      setMessage('Profile details could not be saved. Please try again.');
      return;
    }
    setMessage('Profile saved.');
  };

  const saveAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    if (!supabase) {
      setMessage('Address services are not configured.');
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const parsed = savedAddressSchema.safeParse({
      label: form.get('label'),
      recipientName: form.get('recipient'),
      phone: form.get('addressPhone'),
      addressLine: form.get('line'),
      city: form.get('city'),
      county: String(form.get('county') ?? '').trim()
    });
    if (!parsed.success) {
      setMessage('Check the address label, recipient, contact number and address fields.');
      return;
    }

    const row = {
      user_id: userId,
      label: parsed.data.label,
      recipient_name: parsed.data.recipientName,
      phone: parsed.data.phone,
      address_line: parsed.data.addressLine,
      city: parsed.data.city,
      county: parsed.data.county || null
    };
    setBusy(true);
    const result = editing
      ? await supabase.from('addresses').update(row).eq('id', editing.id).eq('user_id', userId)
      : await supabase.from('addresses').insert(row);
    setBusy(false);
    if (result.error) {
      console.error('Address could not be saved.', result.error.message);
      setMessage('Address could not be saved. Please try again.');
      return;
    }
    setEditing(null);
    setMessage('Address saved.');
    await load();
  };

  const setDefault = async (address: Address) => {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage('');
    const { error: defaultError } = await supabase.rpc('set_default_customer_address', { p_address_id: address.id });
    setBusy(false);
    if (defaultError) {
      console.error('Default address could not be changed.', defaultError.message);
      setMessage('Default address could not be changed. Please try again.');
      return;
    }
    setMessage('Default address updated.');
    await load();
  };

  const removeAddress = async (address: Address) => {
    if (!supabase || busy || address.used_by_order) return;
    if (!window.confirm(`Remove the ${address.label} address?`)) return;
    setBusy(true);
    const { error: removeError } = await supabase.from('addresses').delete().eq('id', address.id).eq('user_id', userId);
    setBusy(false);
    if (removeError) {
      console.error('Address could not be removed.', removeError.message);
      setMessage('Address could not be removed. It may be linked to an order.');
      return;
    }
    if (editing?.id === address.id) setEditing(null);
    setMessage('Address removed.');
    await load();
  };

  const exportData = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage('');
    const results = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('addresses').select('*').eq('user_id', userId),
      supabase.from('orders').select('*,order_items(*)').eq('user_id', userId),
      supabase.from('sourcing_requests').select('*').eq('user_id', userId),
      supabase.from('quotations').select('*,quotation_items(*)').eq('user_id', userId),
      supabase.from('payments').select('*').eq('user_id', userId),
      supabase.from('notifications').select('*').eq('user_id', userId),
      supabase.from('support_cases').select('*').eq('user_id', userId),
      supabase.from('wishlists').select('*,wishlist_items(*)').eq('user_id', userId)
    ]);
    setBusy(false);
    const failed = results.find(result => result.error);
    if (failed?.error) {
      console.error('Account data export failed.', failed.error.message);
      setMessage('We could not prepare your account export. Please try again later.');
      return;
    }

    const [profile, savedAddresses, orders, requests, quotations, payments, notifications, supportCases, wishlists] = results.map(result => result.data);
    const blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      profile,
      addresses: savedAddresses,
      orders,
      sourcingRequests: requests,
      quotations,
      payments,
      notifications,
      supportCases,
      wishlists
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'hopnshop-account-export.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Your account export was downloaded.');
  };

  return <section className="account-section customer-profile-section">
    <h3>Profile and addresses</h3>
    {loading ? <p role="status">Loading your profile and saved addresses…</p> : error ? <div role="alert"><p>{error}</p><button className="text-button" type="button" onClick={() => void load()}>Try again</button></div> : <>
      <form className="customer-profile-form" onSubmit={saveProfile}>
        <label>Full name<input value={name} maxLength={120} autoComplete="name" onChange={event => setName(event.target.value)} /></label>
        <label>Phone<input value={phone} maxLength={24} autoComplete="tel" onChange={event => setPhone(event.target.value)} /></label>
        <button className="button button-dark" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </form>
      <h4>Saved addresses</h4>
      {addresses.length === 0 ? <p className="account-empty">No saved addresses yet.</p> : addresses.map(address => <article className="account-card" key={address.id}>
        <div className="account-card-heading"><strong>{address.label}</strong><span>{address.is_default ? 'Default' : ''}</span></div>
        <p>{address.recipient_name} | {address.phone}</p>
        <p>{address.address_line}, {address.city}{address.county ? `, ${address.county}` : ''}</p>
        {address.used_by_order && <small>This address is linked to an order and is retained for order history.</small>}
        <div className="hero-actions">
          <button className="text-button" type="button" onClick={() => { setEditing(address); setMessage(''); }}>Edit</button>
          {!address.is_default && <button className="text-button" type="button" disabled={busy} onClick={() => void setDefault(address)}>Make default</button>}
          {!address.used_by_order && <button className="text-button" type="button" disabled={busy} onClick={() => void removeAddress(address)}>Remove</button>}
        </div>
      </article>)}
      <form className="customer-address-form" key={editing?.id ?? 'new-address'} onSubmit={saveAddress}>
        <h5>{editing ? `Edit ${editing.label}` : 'Add an address'}</h5>
        <label>Address label<input name="label" required minLength={2} maxLength={60} defaultValue={editing?.label ?? ''} /></label>
        <label>Recipient<input name="recipient" required minLength={2} maxLength={120} autoComplete="name" defaultValue={editing?.recipient_name ?? ''} /></label>
        <label>Phone<input name="addressPhone" required minLength={8} maxLength={24} autoComplete="tel" defaultValue={editing?.phone ?? ''} /></label>
        <label>Street address<textarea name="line" required minLength={5} maxLength={300} autoComplete="street-address" defaultValue={editing?.address_line ?? ''} /></label>
        <div className="quote-cost-grid">
          <label>City<input name="city" required minLength={2} maxLength={100} autoComplete="address-level2" defaultValue={editing?.city ?? ''} /></label>
          <label>County<input name="county" maxLength={100} autoComplete="address-level1" defaultValue={editing?.county ?? ''} /></label>
        </div>
        <button className="button button-dark" type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Update address' : 'Add address'}</button>
        {editing && <button className="text-button" type="button" onClick={() => setEditing(null)}>Cancel edit</button>}
      </form>
      <button className="text-button" type="button" onClick={() => void exportData()} disabled={busy}>{busy ? 'Working…' : 'Download my account data'}</button>
    </>}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}

export default CustomerProfile;
