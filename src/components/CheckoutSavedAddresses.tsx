import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface SavedAddress {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  address_line: string;
  city: string;
  county: string | null;
  is_default: boolean;
}

interface CheckoutSavedAddressesProps {
  userId: string;
  onSelect: (address: { recipient_name: string; phone: string; address_line: string; city: string; county: string } | null) => void;
}

function CheckoutSavedAddresses({ userId, onSelect }: CheckoutSavedAddressesProps) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    if (!supabase) {
      setLoading(false);
      setError('Saved addresses are unavailable because account services are not configured.');
      return () => { active = false; };
    }

    setLoading(true);
    setError('');
    const client = supabase;
    void (async () => {
      try {
        const { data, error: loadError } = await client.from('addresses')
          .select('id,label,recipient_name,phone,address_line,city,county,is_default')
          .eq('user_id', userId)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: false });
        if (!active) return;
        if (loadError) {
          console.error('Saved checkout addresses could not be loaded.', loadError.message);
          setError('Saved addresses could not be loaded. You can still enter delivery details manually.');
        } else {
          setAddresses(data ?? []);
        }
        setLoading(false);
      } catch (loadError) {
        if (!active) return;
        console.error('Saved checkout addresses could not be loaded.', loadError instanceof Error ? loadError.message : String(loadError));
        setError('Saved addresses could not be loaded. You can still enter delivery details manually.');
        setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [userId, reload]);

  const selectAddress = (addressId: string) => {
    setSelectedId(addressId);
    const address = addresses.find(item => item.id === addressId);
    if (!address) {
      onSelect(null);
    } else {
      onSelect({
        recipient_name: address.recipient_name,
        phone: address.phone,
        address_line: address.address_line,
        city: address.city,
        county: address.county ?? ''
      });
    }
  };

  if (loading) return <p className="checkout-address-status" role="status">Loading saved addresses…</p>;
  if (error) return <div className="checkout-address-status" role="alert"><p>{error}</p><button className="text-button" type="button" onClick={() => setReload(value => value + 1)}>Try again</button></div>;
  if (addresses.length === 0) return <p className="checkout-address-status">No saved addresses yet. You can add one from your account profile.</p>;

  return <div className="checkout-address-picker">
    <label htmlFor="saved-checkout-address">Use a saved address</label>
    <select id="saved-checkout-address" value={selectedId} onChange={event => selectAddress(event.target.value)}>
      <option value="">Enter a different address</option>
      {addresses.map(address => <option key={address.id} value={address.id}>{address.label}{address.is_default ? ' (default)' : ''} — {address.city}</option>)}
    </select>
    <small>Order details are copied into an order-specific delivery record. Editing this form will not change your saved address.</small>
  </div>;
}

export default CheckoutSavedAddresses;
