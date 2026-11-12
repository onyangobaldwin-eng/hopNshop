import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface County { name: string }
interface Courier { id: string; name: string; active: boolean }
interface Locality { id: string; county: string; town: string; locality: string; active: boolean }
interface ServiceArea { id: string; courier_id: string; locality_id: string; service_type: string; active: boolean }
interface ServiceRate { id: string; service_area_id: string; rate_source: string; quoted_at: string; expires_at: string; active: boolean }
interface ProductOption { id: string; name: string }
interface SupplierOption { id: string; name: string; verification_status: string }
interface Fulfilment {
  id: string;
  order_id: string;
  order_item_id: string;
  supplier_id: string | null;
  route: 'hub' | 'direct_supplier';
  recommended_route: 'hub' | 'direct_supplier';
  route_override_reason: string | null;
  status: string;
  order_number: string;
  order_status: string;
  delivery_locality_id: string | null;
  description: string;
  quantity: number;
  supplier_name: string;
  currency: string;
  order_total: number | string;
  delivery_fee: number | string | null;
}
interface IncomingShipment { id: string; fulfilment_id: string; tracking_reference: string | null; status: string }
interface DeliveryParcel { id: string; fulfilment_id: string | null; order_id: string; status: string; tracking_reference: string | null }
interface DeliveryReturn { id: string; parcel_id: string; status: string; reason: string; notes: string }

const fulfilmentTransitions: Record<string, string[]> = {
  procurement_pending: ['procurement_approved'],
  procurement_approved: ['supplier_ordered'],
  supplier_ordered: ['supplier_processing'],
  supplier_processing: ['supplier_dispatched'],
  supplier_dispatched: ['received_at_hub'],
  received_at_hub: ['inspection_pending'],
  inspection_pending: ['inspection_passed', 'inspection_exception'],
  inspection_exception: ['inspection_pending'],
  inspection_passed: ['packaging'],
  packaging: ['ready_to_dispatch'],
  ready_to_dispatch: ['courier_assigned'],
  courier_assigned: ['collected']
};

const deliveryEvents: Record<string, string[]> = {
  ready_for_dispatch: ['courier_assigned'],
  courier_assigned: ['collected'],
  collected: ['in_transit'],
  in_transit: ['out_for_delivery', 'delivery_failed'],
  out_for_delivery: ['delivery_attempted', 'delivered', 'delivery_failed'],
  delivery_attempted: ['out_for_delivery', 'delivered', 'delivery_failed'],
  delivery_failed: ['courier_assigned', 'return_initiated'],
  return_initiated: ['returned_to_sender']
};
const returnTransitions: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['in_transit', 'received'],
  in_transit: ['received'],
  received: ['refund_pending'],
  refund_pending: ['refunded']
};

interface AdminDeliveryManagementProps {
  canManageConfiguration: boolean;
}

async function uploadEvidence(orderId: string, file: File) {
  if (!supabase) throw new Error('Delivery storage is not configured.');
  const extension = file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
      : file.type === 'application/pdf' ? 'pdf' : 'jpg';
  const path = `${orderId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('delivery-evidence').upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) throw error;
  return path;
}

function AdminDeliveryManagement({ canManageConfiguration }: AdminDeliveryManagementProps) {
  const [counties, setCounties] = useState<County[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const [rates, setRates] = useState<ServiceRate[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [permissions, setPermissions] = useState<Record<string, {
    direct_to_customer: boolean;
    neutral_packaging: boolean;
    tracking_provided: boolean;
    delivery_evidence_provided: boolean;
    returns_terms: string | null;
    damaged_shipment_terms: string | null;
    lost_parcel_terms: string | null;
    delivery_timeframe: string | null;
  }>>({});
  const [fulfilments, setFulfilments] = useState<Fulfilment[]>([]);
  const [shipments, setShipments] = useState<IncomingShipment[]>([]);
  const [parcels, setParcels] = useState<DeliveryParcel[]>([]);
  const [deliveryReturns, setDeliveryReturns] = useState<DeliveryReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError('Delivery management services are not configured.');
      return;
    }
    setLoading(true);
    setError('');
    const [countyResult, courierResult, localityResult, areaResult, rateResult, productResult, supplierResult, permissionResult, fulfilmentResult] = await Promise.all([
      supabase.from('delivery_counties').select('name').order('name'),
      supabase.from('courier_partners').select('id,name,active').order('name'),
      supabase.from('delivery_localities').select('id,county,town,locality,active').order('county').order('town'),
      supabase.from('courier_service_areas').select('id,courier_id,locality_id,service_type,active'),
      canManageConfiguration
        ? supabase.from('delivery_rate_cards').select('id,service_area_id,rate_source,quoted_at,expires_at,active').order('quoted_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canManageConfiguration
        ? supabase.from('products').select('id,name').eq('business_model', 'resale').order('name')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('suppliers').select('id,name,verification_status').order('name'),
      canManageConfiguration
        ? supabase.from('supplier_fulfilment_permissions').select('supplier_id,direct_to_customer,neutral_packaging,tracking_provided,delivery_evidence_provided,returns_terms,damaged_shipment_terms,lost_parcel_terms,delivery_timeframe')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('order_fulfilments').select('id,order_id,order_item_id,supplier_id,route,recommended_route,route_override_reason,status').order('created_at', { ascending: false })
    ]);
    const results = [countyResult, courierResult, localityResult, areaResult, rateResult, productResult, supplierResult, permissionResult, fulfilmentResult];
    const failed = results.find(result => result.error);
    if (failed?.error) {
      console.error('Delivery management data could not be loaded.', failed.error.message);
      setError('We could not load delivery settings and fulfilments. Apply the delivery migration and check staff access.');
      setLoading(false);
      return;
    }

    const nextFulfilments = (fulfilmentResult.data ?? []) as Omit<Fulfilment, 'order_number' | 'order_status' | 'delivery_locality_id' | 'description' | 'quantity' | 'supplier_name'>[];
    const orderIds = [...new Set(nextFulfilments.map(item => item.order_id))];
    const itemIds = [...new Set(nextFulfilments.map(item => item.order_item_id))];
    const supplierIds = [...new Set(nextFulfilments.map(item => item.supplier_id).filter((id): id is string => Boolean(id)))];
    const [ordersResult, itemsResult, supplierNamesResult, incomingResult, parcelResult] = await Promise.all([
      orderIds.length ?       supabase.from('orders').select('id,order_number,status,delivery_locality_id,currency,total,delivery_fee').in('id', orderIds) : Promise.resolve({ data: [], error: null }),
      itemIds.length ? supabase.from('order_items').select('id,description,quantity').in('id', itemIds) : Promise.resolve({ data: [], error: null }),
      supplierIds.length ? supabase.from('suppliers').select('id,name').in('id', supplierIds) : Promise.resolve({ data: [], error: null }),
      nextFulfilments.length ? supabase.from('incoming_supplier_shipments').select('id,fulfilment_id,tracking_reference,status').in('fulfilment_id', nextFulfilments.map(item => item.id)) : Promise.resolve({ data: [], error: null }),
      nextFulfilments.length ? supabase.from('delivery_parcels').select('id,fulfilment_id,order_id,status,tracking_reference').in('fulfilment_id', nextFulfilments.map(item => item.id)) : Promise.resolve({ data: [], error: null })
    ]);
    const secondaryFailure = [ordersResult, itemsResult, supplierNamesResult, incomingResult, parcelResult].find(result => result.error);
    if (secondaryFailure?.error) {
      console.error('Delivery order details could not be loaded.', secondaryFailure.error.message);
      setError('Delivery settings loaded, but some order details could not be loaded.');
    }
    const orderById = new Map((ordersResult.data ?? []).map((item: any) => [item.id, item]));
    const orderItemById = new Map((itemsResult.data ?? []).map((item: any) => [item.id, item]));
    const supplierById = new Map((supplierNamesResult.data ?? []).map((item: any) => [item.id, item]));
    setFulfilments(nextFulfilments.map(item => {
      const order = orderById.get(item.order_id) as any;
      const orderItem = orderItemById.get(item.order_item_id) as any;
      const supplier = item.supplier_id ? supplierById.get(item.supplier_id) as any : null;
      return {
        ...item,
        order_number: order?.order_number ?? 'Order details unavailable',
        order_status: order?.status ?? 'unknown',
        delivery_locality_id: order?.delivery_locality_id ?? null,
        description: orderItem?.description ?? 'Order item unavailable',
        quantity: orderItem?.quantity ?? 0,
        supplier_name: supplier?.name ?? 'Unassigned supplier',
        currency: order?.currency ?? 'KES',
        order_total: order?.total ?? 0,
        delivery_fee: order?.delivery_fee ?? null
      };
    }));
    setCounties((countyResult.data ?? []) as County[]);
    setCouriers((courierResult.data ?? []) as Courier[]);
    setLocalities((localityResult.data ?? []) as Locality[]);
    setServiceAreas((areaResult.data ?? []) as ServiceArea[]);
    setRates((rateResult.data ?? []) as ServiceRate[]);
    setProducts((productResult.data ?? []) as ProductOption[]);
    setSuppliers((supplierResult.data ?? []) as SupplierOption[]);
    setPermissions(Object.fromEntries((permissionResult.data ?? []).map((row: any) => [row.supplier_id, row])));
    setShipments((incomingResult.data ?? []) as IncomingShipment[]);
    setParcels((parcelResult.data ?? []) as DeliveryParcel[]);
    if (parcelResult.data?.length) {
      const { data: returnData, error: returnError } = await supabase.from('delivery_returns')
        .select('id,parcel_id,status,reason,notes')
        .in('parcel_id', parcelResult.data.map((parcel: DeliveryParcel) => parcel.id))
        .order('created_at', { ascending: false });
      if (returnError) {
        console.error('Delivery return requests could not be loaded.', returnError.message);
        setError('Delivery settings loaded, but return requests could not be loaded.');
      }
      setDeliveryReturns((returnData ?? []) as DeliveryReturn[]);
    } else {
      setDeliveryReturns([]);
    }
    setLoading(false);
  }, [canManageConfiguration]);

  useEffect(() => { void loadData(); }, [loadData]);

  const submitRpc = async (key: string, rpc: string, args: Record<string, unknown>, form?: HTMLFormElement) => {
    if (!supabase) return;
    setWorking(key);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc(rpc, args);
    setWorking('');
    if (rpcError) {
      console.error(`${rpc} failed.`, rpcError.message);
      setError('That delivery update could not be saved. Check the current workflow status and required evidence.');
      return;
    }
    form?.reset();
    setNotice('Delivery information saved.');
    await loadData();
  };

  const setActiveState = async (
    table: 'courier_partners' | 'delivery_localities' | 'courier_service_areas' | 'delivery_rate_cards',
    id: string,
    active: boolean
  ) => {
    if (!supabase) return;
    const key = `${table}-${id}`;
    setWorking(key);
    setError('');
    setNotice('');
    const { error: updateError } = await supabase.from(table).update({ active }).eq('id', id);
    setWorking('');
    if (updateError) {
      console.error(`Could not update ${table} active state.`, updateError.message);
      setError('That delivery configuration could not be updated.');
      return;
    }
    setNotice(active ? 'Delivery configuration activated.' : 'Delivery configuration deactivated.');
    await loadData();
  };

  const saveCourier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setWorking('courier');
    setError('');
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setWorking('');
      setError('Sign in again before managing courier partners.');
      return;
    }
    const { error: saveError } = await supabase.from('courier_partners').insert({
      name: String(data.get('name')).trim(),
      contact_name: String(data.get('contact_name') ?? '').trim() || null,
      contact_email: String(data.get('contact_email') ?? '').trim() || null,
      contact_phone: String(data.get('contact_phone') ?? '').trim() || null,
      tracking_url_template: String(data.get('tracking_url_template') ?? '').trim() || null,
      collection_terms: String(data.get('collection_terms') ?? '').trim() || null,
      returns_terms: String(data.get('returns_terms') ?? '').trim() || null,
      api_status: 'manual',
      active: data.get('activate') === 'on',
      created_by: userData.user.id
    });
    setWorking('');
    if (saveError) {
      console.error('Courier partner could not be saved.', saveError.message);
      setError('Courier partner could not be saved. Confirm that its name and HTTPS tracking template are valid.');
      return;
    }
    form.reset();
    setNotice('Courier partner saved. Tracking remains manual; no courier API is configured.');
    await loadData();
  };

  const saveLocality = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setWorking('locality');
    setError('');
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setWorking('');
      setError('Sign in again before managing service areas.');
      return;
    }
    const { error: saveError } = await supabase.from('delivery_localities').insert({
      county: String(data.get('county')),
      town: String(data.get('town')).trim(),
      locality: String(data.get('locality')).trim(),
      estate_or_neighbourhood: String(data.get('estate') ?? '').trim() || null,
      pickup_point: String(data.get('pickup_point') ?? '').trim() || null,
      active: data.get('active') === 'on',
      created_by: userData.user.id
    });
    setWorking('');
    if (saveError) {
      console.error('Delivery locality could not be saved.', saveError.message);
      setError('Delivery locality could not be saved. Check for an existing duplicate locality.');
      return;
    }
    form.reset();
    setNotice('Locality saved. Customers will only see it when an active courier and current rate are configured.');
    await loadData();
  };

  const saveServiceAreaAndRate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setWorking('rate');
    setError('');
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setWorking('');
      setError('Sign in again before managing courier rates.');
      return;
    }
    const courierId = String(data.get('courier_id'));
    const localityId = String(data.get('locality_id'));
    const serviceType = String(data.get('service_type'));
    const { data: area, error: areaError } = await supabase.from('courier_service_areas').upsert({
      courier_id: courierId,
      locality_id: localityId,
      service_type: serviceType,
      active: data.get('area_active') === 'on'
    }, { onConflict: 'courier_id,locality_id,service_type' }).select('id').single();
    if (areaError || !area) {
      setWorking('');
      console.error('Courier service area could not be saved.', areaError?.message);
      setError('Courier service area could not be saved. Confirm the selected courier and locality are valid.');
      return;
    }
    const optionalDimension = (name: string) => {
      const value = String(data.get(name) ?? '').trim();
      return value ? Number(value) : null;
    };
    const { error: rateError } = await supabase.from('delivery_rate_cards').insert({
      service_area_id: area.id,
      currency: 'KES',
      base_fee: Number(data.get('base_fee')),
      per_parcel_fee: Number(data.get('per_parcel_fee') || 0),
      per_kg_fee: Number(data.get('per_kg_fee') || 0),
      max_parcel_weight_kg: Number(data.get('max_parcel_weight_kg')),
      max_length_cm: optionalDimension('max_length_cm'),
      max_width_cm: optionalDimension('max_width_cm'),
      max_height_cm: optionalDimension('max_height_cm'),
      remote_area_surcharge: Number(data.get('remote_area_surcharge') || 0),
      special_handling_fee: Number(data.get('special_handling_fee') || 0),
      min_delivery_days: Number(data.get('min_delivery_days')),
      max_delivery_days: Number(data.get('max_delivery_days')),
      rate_source: String(data.get('rate_source')).trim(),
      quoted_at: new Date(`${String(data.get('quoted_at'))}T12:00:00Z`).toISOString(),
      expires_at: String(data.get('expires_at') ?? '') ? new Date(`${String(data.get('expires_at'))}T23:59:59Z`).toISOString() : null,
      active: data.get('rate_active') === 'on',
      created_by: userData.user.id
    });
    setWorking('');
    if (rateError) {
      console.error('Courier rate could not be saved.', rateError.message);
      setError('Service area was saved, but its rate was not. Review the rate fields and retry.');
      await loadData();
      return;
    }
    form.reset();
    setNotice('Rate saved. Public delivery quotes use this rate only while it is active and unexpired.');
    await loadData();
  };

  const saveProductSpecs = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setWorking('specs');
    setError('');
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setWorking('');
      setError('Sign in again before editing product shipping dimensions.');
      return;
    }
    const { error: saveError } = await supabase.from('product_delivery_specs').upsert({
      product_id: String(data.get('product_id')),
      weight_kg: Number(data.get('weight_kg')),
      length_cm: Number(data.get('length_cm')),
      width_cm: Number(data.get('width_cm')),
      height_cm: Number(data.get('height_cm')),
      special_handling: data.get('special_handling') === 'on',
      inspection_required: true,
      updated_by: userData.user.id
    }, { onConflict: 'product_id' });
    setWorking('');
    if (saveError) {
      console.error('Product shipping dimensions could not be saved.', saveError.message);
      setError('Product dimensions could not be saved. All four positive measurements are required.');
      return;
    }
    form.reset();
    setNotice('Product shipping dimensions saved. Delivery estimates will use the new values.');
    await loadData();
  };

  const saveSupplierPermission = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const supplierId = String(data.get('supplier_id'));
    const direct = data.get('direct_to_customer') === 'on';
    const selectedSupplier = suppliers.find(supplier => supplier.id === supplierId);
    if (!selectedSupplier || selectedSupplier.verification_status !== 'verified') {
      setError('Only a verified supplier can be granted a direct-delivery permission.');
      return;
    }
    if (direct && (
      data.get('neutral_packaging') !== 'on'
      || data.get('tracking_provided') !== 'on'
      || data.get('delivery_evidence_provided') !== 'on'
      || String(data.get('returns_terms') ?? '').trim().length < 2
      || String(data.get('damaged_shipment_terms') ?? '').trim().length < 2
      || String(data.get('lost_parcel_terms') ?? '').trim().length < 2
      || String(data.get('delivery_timeframe') ?? '').trim().length < 2
    )) {
      setError('Direct delivery requires neutral packaging, tracking, delivery evidence and documented return, damage, loss and timing terms.');
      return;
    }
    setWorking('permission');
    setError('');
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setWorking('');
      setError('Sign in again before managing supplier permissions.');
      return;
    }
    const { error: saveError } = await supabase.from('supplier_fulfilment_permissions').upsert({
      supplier_id: supplierId,
      direct_to_customer: direct,
      neutral_packaging: data.get('neutral_packaging') === 'on',
      tracking_provided: data.get('tracking_provided') === 'on',
      delivery_evidence_provided: data.get('delivery_evidence_provided') === 'on',
      returns_terms: String(data.get('returns_terms') ?? '').trim() || null,
      damaged_shipment_terms: String(data.get('damaged_shipment_terms') ?? '').trim() || null,
      lost_parcel_terms: String(data.get('lost_parcel_terms') ?? '').trim() || null,
      delivery_timeframe: String(data.get('delivery_timeframe') ?? '').trim() || null,
      approved_by: direct ? userData.user.id : null,
      approved_at: direct ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'supplier_id' });
    setWorking('');
    if (saveError) {
      console.error('Supplier fulfilment permission could not be saved.', saveError.message);
      setError('Supplier permission could not be saved. Direct delivery requires verified supplier status and all agreement terms.');
      return;
    }
    form.reset();
    setNotice('Supplier fulfilment terms saved.');
    await loadData();
  };

  const transitionFulfilment = async (event: FormEvent<HTMLFormElement>, item: Fulfilment) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submitRpc(`transition-${item.id}`, 'admin_transition_order_fulfilment', {
      p_fulfilment_id: item.id,
      p_new_status: String(data.get('new_status')),
      p_notes: String(data.get('notes')).trim()
    }, form);
  };

  const overrideRoute = async (event: FormEvent<HTMLFormElement>, item: Fulfilment) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submitRpc(`route-${item.id}`, 'admin_override_fulfilment_route', {
      p_fulfilment_id: item.id,
      p_route: String(data.get('route')),
      p_reason: String(data.get('reason')).trim()
    }, form);
  };

  const registerIncoming = async (event: FormEvent<HTMLFormElement>, item: Fulfilment) => {
    event.preventDefault();
    if (!supabase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('evidence');
    if (!(file instanceof File) || file.size === 0) {
      setError('Upload supplier dispatch evidence before registering the incoming shipment.');
      return;
    }
    setWorking(`incoming-${item.id}`);
    setError('');
    try {
      const path = await uploadEvidence(item.order_id, file);
      await submitRpc(`incoming-${item.id}`, 'admin_register_incoming_supplier_shipment', {
        p_fulfilment_id: item.id,
        p_supplier_reference: String(data.get('supplier_reference') ?? '').trim() || null,
        p_tracking_reference: String(data.get('tracking_reference')).trim(),
        p_dispatch_evidence_path: path
      }, form);
    } catch (uploadError) {
      console.error('Supplier dispatch evidence could not be uploaded.', uploadError);
      setWorking('');
      setError('Evidence upload failed. Try another permitted image or PDF.');
    }
  };

  const inspectIncoming = async (event: FormEvent<HTMLFormElement>, shipment: IncomingShipment) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submitRpc(`inspection-${shipment.id}`, 'admin_record_delivery_inspection', {
      p_shipment_id: shipment.id,
      p_result: String(data.get('result')),
      p_findings: String(data.get('findings')).trim(),
      p_evidence_paths: []
    }, form);
  };

  const createParcel = async (event: FormEvent<HTMLFormElement>, item: Fulfilment) => {
    event.preventDefault();
    if (!supabase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('evidence');
    if (!(file instanceof File) || file.size === 0) {
      setError('Upload dispatch evidence before creating the parcel.');
      return;
    }
    setWorking(`parcel-${item.id}`);
    setError('');
    try {
      const path = await uploadEvidence(item.order_id, file);
      const { data: parcelId, error: createError } = await supabase.rpc('admin_create_delivery_parcel', {
        p_order_id: item.order_id,
        p_fulfilment_id: item.id,
        p_service_area_id: String(data.get('service_area_id')),
        p_tracking_reference: String(data.get('tracking_reference')).trim(),
        p_dispatch_evidence_path: path,
        p_estimated_start: String(data.get('estimated_start') ?? '') || null,
        p_estimated_end: String(data.get('estimated_end') ?? '') || null
      });
      if (createError || !parcelId) {
        setWorking('');
        console.error('Delivery parcel could not be created.', createError?.message);
        setError('Parcel could not be created. Confirm the order is paid, service area is current, and hub inspection or direct-supplier approval is complete.');
        return;
      }
      const { error: itemError } = await supabase.rpc('admin_add_delivery_parcel_item', {
        p_parcel_id: parcelId,
        p_order_item_id: item.order_item_id,
        p_quantity: item.quantity
      });
      setWorking('');
      if (itemError) {
        console.error('Parcel contents could not be attached.', itemError.message);
        setError('Parcel was created, but its order item could not be attached. Ask an administrator to reconcile parcel contents.');
      } else {
        form.reset();
        setNotice('Parcel created and its ordered item assigned.');
      }
      await loadData();
    } catch (uploadError) {
      console.error('Delivery dispatch evidence could not be uploaded.', uploadError);
      setWorking('');
      setError('Evidence upload failed. Try another permitted image or PDF.');
    }
  };

  const recordParcelEvent = async (event: FormEvent<HTMLFormElement>, parcel: DeliveryParcel) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submitRpc(`event-${parcel.id}`, 'admin_record_delivery_event', {
      p_parcel_id: parcel.id,
      p_status: String(data.get('status')),
      p_notes: String(data.get('notes')).trim(),
      p_idempotency_key: crypto.randomUUID(),
      p_provider_reference: parcel.tracking_reference,
      p_happened_at: new Date().toISOString()
    }, form);
  };

  const recordProof = async (event: FormEvent<HTMLFormElement>, parcel: DeliveryParcel) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submitRpc(`proof-${parcel.id}`, 'admin_record_delivery_proof', {
      p_parcel_id: parcel.id,
      p_recipient_name: String(data.get('recipient_name')).trim(),
      p_confirmation_method: 'recipient_confirmation',
      p_courier_reference: parcel.tracking_reference,
      p_signature_path: null,
      p_photo_path: null,
      p_dispute_notes: null
    }, form);
  };

  const requestFeeChange = async (event: FormEvent<HTMLFormElement>, item: Fulfilment) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submitRpc(`fee-${item.order_id}`, 'admin_request_delivery_fee_change', {
      p_order_id: item.order_id,
      p_requested_fee: Number(data.get('requested_fee')),
      p_reason: String(data.get('reason')).trim()
    }, form);
  };

  const recordAttempt = async (event: FormEvent<HTMLFormElement>, parcel: DeliveryParcel) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submitRpc(`attempt-${parcel.id}`, 'admin_record_delivery_attempt', {
      p_parcel_id: parcel.id,
      p_outcome: String(data.get('outcome')),
      p_notes: String(data.get('notes')).trim()
    }, form);
  };

  const updateReturn = async (event: FormEvent<HTMLFormElement>, request: DeliveryReturn) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submitRpc(`return-${request.id}`, 'admin_update_delivery_return', {
      p_return_id: request.id,
      p_new_status: String(data.get('new_status')),
      p_notes: String(data.get('notes')).trim()
    }, form);
  };

  if (loading) return <section className="admin-queue"><p role="status">Loading delivery operations…</p></section>;

  return <section className="admin-queue admin-delivery-management">
    <div className="section-heading">
      <div><p className="eyebrow">Admin · fulfilment</p><h3>Delivery operations</h3></div>
      <button className="text-button" onClick={() => void loadData()} disabled={loading}>Refresh</button>
    </div>
    <p className="overview-note">Coverage, prices, courier names and delivery dates below are staff-configured operational data, not automatic courier integrations. Only configure areas and rates confirmed with the partner.</p>
    {error && <p className="form-message" role="alert">{error}</p>}
    {notice && <p className="form-message success" role="status">{notice}</p>}

    {canManageConfiguration && <details className="delivery-admin-section" open>
      <summary>Courier partners and verified rates</summary>
      <div className="delivery-admin-grid">
        <form className="admin-product-form" onSubmit={event => void saveCourier(event)}>
          <h4>Add courier partner</h4>
          <label>Partner name<input name="name" required minLength={2} maxLength={160} /></label>
          <label>Contact name<input name="contact_name" maxLength={160} /></label>
          <label>Contact email<input name="contact_email" type="email" maxLength={254} /></label>
          <label>Contact phone<input name="contact_phone" type="tel" maxLength={30} /></label>
          <label>Tracking URL template<input name="tracking_url_template" type="url" placeholder="https://" /></label>
          <label>Collection terms<textarea name="collection_terms" maxLength={1000} /></label>
          <label>Returns terms<textarea name="returns_terms" maxLength={1000} /></label>
          <label className="product-publish-confirm"><input name="activate" type="checkbox" /> Confirmed partner agreement and active service</label>
          <button className="button button-dark" disabled={working === 'courier'}>{working === 'courier' ? 'Saving…' : 'Save courier'}</button>
        </form>
        <form className="admin-product-form" onSubmit={event => void saveLocality(event)}>
          <h4>Add serviceable locality</h4>
          <label>County<select name="county" required defaultValue=""><option value="" disabled>Choose county</option>{counties.map(county => <option key={county.name}>{county.name}</option>)}</select></label>
          <label>Town<input name="town" required minLength={2} maxLength={120} /></label>
          <label>Locality<input name="locality" required minLength={2} maxLength={160} /></label>
          <label>Estate / neighbourhood<input name="estate" maxLength={160} /></label>
          <label>Pickup point<input name="pickup_point" maxLength={300} /></label>
          <label className="product-publish-confirm"><input name="active" type="checkbox" /> Confirm this locality is serviceable</label>
          <button className="button button-dark" disabled={working === 'locality'}>{working === 'locality' ? 'Saving…' : 'Save locality'}</button>
        </form>
        <form className="admin-product-form" onSubmit={event => void saveServiceAreaAndRate(event)}>
          <h4>Configure courier rate</h4>
          <label>Active courier<select name="courier_id" required defaultValue=""><option value="" disabled>Choose courier</option>{couriers.map(courier => <option key={courier.id} value={courier.id} disabled={!courier.active}>{courier.name}{courier.active ? '' : ' (inactive)'}</option>)}</select></label>
          <label>Locality<select name="locality_id" required defaultValue=""><option value="" disabled>Choose locality</option>{localities.map(locality => <option key={locality.id} value={locality.id}>{locality.town} · {locality.locality}, {locality.county}{locality.active ? '' : ' (inactive)'}</option>)}</select></label>
          <label>Service<select name="service_type"><option value="doorstep">Doorstep</option><option value="pickup_point">Pickup point</option></select></label>
          <div className="quote-cost-grid">
            <label>Base fee (KES)<input name="base_fee" type="number" min="0" step="0.01" required /></label>
            <label>Per parcel (KES)<input name="per_parcel_fee" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Per kg (KES)<input name="per_kg_fee" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Max kg / parcel<input name="max_parcel_weight_kg" type="number" min="0.001" step="0.001" required /></label>
            <label>Remote surcharge (KES)<input name="remote_area_surcharge" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Special handling (KES)<input name="special_handling_fee" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Max length cm<input name="max_length_cm" type="number" min="0.01" step="0.01" /></label>
            <label>Max width cm<input name="max_width_cm" type="number" min="0.01" step="0.01" /></label>
            <label>Max height cm<input name="max_height_cm" type="number" min="0.01" step="0.01" /></label>
            <label>Minimum days<input name="min_delivery_days" type="number" min="1" step="1" required /></label>
            <label>Maximum days<input name="max_delivery_days" type="number" min="1" step="1" required /></label>
            <label>Source / evidence<input name="rate_source" required minLength={2} maxLength={300} placeholder="Partner quote reference / source" /></label>
            <label>Rate quoted<input name="quoted_at" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label>Rate expires<input name="expires_at" type="date" required min={new Date().toISOString().slice(0, 10)} /></label>
          </div>
          <label className="product-publish-confirm"><input name="area_active" type="checkbox" /> Activate this service area</label>
          <label className="product-publish-confirm"><input name="rate_active" type="checkbox" /> Confirm rate is reviewed and activate it</label>
          <button className="button button-dark" disabled={working === 'rate'}>{working === 'rate' ? 'Saving…' : 'Save service area and rate'}</button>
        </form>
      </div>
      <ul className="delivery-config-list">
        {couriers.map(courier => <li key={courier.id}>
          <strong>{courier.name}</strong> · {courier.active ? 'active' : 'inactive'} · manual tracking
          <button className="text-button" disabled={working === `courier_partners-${courier.id}`} onClick={() => void setActiveState('courier_partners', courier.id, !courier.active)}>{courier.active ? 'Deactivate' : 'Activate'}</button>
        </li>)}
        {localities.map(locality => {
          const configuredAreas = serviceAreas.filter(area => area.locality_id === locality.id);
          const currentlyAvailable = locality.active && configuredAreas.some(area => {
            const courier = couriers.find(entry => entry.id === area.courier_id);
            return area.active && courier?.active && rates.some(rate =>
              rate.service_area_id === area.id && rate.active && new Date(rate.expires_at).getTime() > Date.now()
            );
          });
          return <li key={locality.id}>
            {locality.town} · {locality.locality}, {locality.county} · {currentlyAvailable ? 'configured and offered' : 'not offered at checkout'} · {locality.active ? 'active' : 'inactive'}
            <button className="text-button" disabled={working === `delivery_localities-${locality.id}`} onClick={() => void setActiveState('delivery_localities', locality.id, !locality.active)}>{locality.active ? 'Deactivate' : 'Activate'}</button>
            {configuredAreas.map(area => {
              const courier = couriers.find(entry => entry.id === area.courier_id);
              const areaRates = rates.filter(rate => rate.service_area_id === area.id);
              return <ul key={area.id}>
                <li>{courier?.name ?? 'Unknown courier'} · {area.service_type} · service {area.active ? 'active' : 'inactive'}
                  <button className="text-button" disabled={working === `courier_service_areas-${area.id}`} onClick={() => void setActiveState('courier_service_areas', area.id, !area.active)}>{area.active ? 'Deactivate service' : 'Activate service'}</button>
                  {areaRates.map(rate => <div key={rate.id}>
                    {rate.rate_source} · quoted {new Date(rate.quoted_at).toLocaleDateString()} · expires {new Date(rate.expires_at).toLocaleDateString()} · {new Date(rate.expires_at).getTime() > Date.now() ? (rate.active ? 'active' : 'inactive') : 'expired'}
                    <button className="text-button" disabled={working === `delivery_rate_cards-${rate.id}` || (!rate.active && new Date(rate.expires_at).getTime() <= Date.now())} onClick={() => void setActiveState('delivery_rate_cards', rate.id, !rate.active)}>{rate.active ? 'Deactivate rate' : 'Activate rate'}</button>
                  </div>)}
                </li>
              </ul>;
            })}
          </li>;
        })}
      </ul>
    </details>}

    {canManageConfiguration && <details className="delivery-admin-section">
      <summary>Product shipping details and supplier approvals</summary>
      <div className="delivery-admin-grid">
        <form className="admin-product-form" onSubmit={event => void saveProductSpecs(event)}>
          <h4>Product weight and dimensions</h4>
          <label>Resale product<select name="product_id" required defaultValue=""><option value="" disabled>Choose product</option>{products.map(product => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>
          <div className="quote-cost-grid">
            <label>Weight kg<input name="weight_kg" type="number" min="0.001" step="0.001" required /></label>
            <label>Length cm<input name="length_cm" type="number" min="0.01" step="0.01" required /></label>
            <label>Width cm<input name="width_cm" type="number" min="0.01" step="0.01" required /></label>
            <label>Height cm<input name="height_cm" type="number" min="0.01" step="0.01" required /></label>
          </div>
          <label className="product-publish-confirm"><input name="special_handling" type="checkbox" /> Requires special handling</label>
          <button className="button button-dark" disabled={working === 'specs'}>{working === 'specs' ? 'Saving…' : 'Save product dimensions'}</button>
        </form>
        <form className="admin-product-form" onSubmit={event => void saveSupplierPermission(event)}>
          <h4>Supplier direct-delivery approval</h4>
          <label>Verified supplier<select name="supplier_id" required defaultValue=""><option value="" disabled>Choose supplier</option>{suppliers.map(supplier => <option value={supplier.id} key={supplier.id} disabled={supplier.verification_status !== 'verified'}>{supplier.name} · {supplier.verification_status}</option>)}</select></label>
          <label className="product-publish-confirm"><input name="direct_to_customer" type="checkbox" /> Approve direct-to-customer route after reviewing agreement</label>
          <label className="product-publish-confirm"><input name="neutral_packaging" type="checkbox" /> Neutral packaging confirmed</label>
          <label className="product-publish-confirm"><input name="tracking_provided" type="checkbox" /> Tracking reference provided</label>
          <label className="product-publish-confirm"><input name="delivery_evidence_provided" type="checkbox" /> Proof of delivery provided</label>
          <label>Returns terms<textarea name="returns_terms" maxLength={1000} /></label>
          <label>Damaged shipment terms<textarea name="damaged_shipment_terms" maxLength={1000} /></label>
          <label>Lost parcel terms<textarea name="lost_parcel_terms" maxLength={1000} /></label>
          <label>Delivery timeframe<input name="delivery_timeframe" maxLength={300} /></label>
          <button className="button button-dark" disabled={working === 'permission'}>{working === 'permission' ? 'Saving…' : 'Save supplier terms'}</button>
        </form>
      </div>
      <ul className="delivery-config-list">
        {Object.entries(permissions).map(([supplierId, permission]) => <li key={supplierId}>
          {suppliers.find(supplier => supplier.id === supplierId)?.name ?? 'Supplier'} · {permission.direct_to_customer ? 'direct delivery approved' : 'hub route only'} · {permission.neutral_packaging ? 'neutral packaging confirmed' : 'neutral packaging not confirmed'}
        </li>)}
      </ul>
    </details>}

    <details className="delivery-admin-section">
      <summary>Customer return requests ({deliveryReturns.length})</summary>
      {deliveryReturns.length === 0 ? <p className="account-empty">No parcel return requests are awaiting review.</p> : deliveryReturns.map(request => {
        const allowed = returnTransitions[request.status] ?? [];
        return <article className="admin-request" key={request.id}>
          <div className="account-card-heading"><strong>{request.reason.replaceAll('_', ' ')}</strong><span>{request.status.replaceAll('_', ' ')}</span></div>
          <p>Parcel {request.parcel_id} · {request.notes}</p>
          {allowed.length > 0 && <form className="admin-order-form" onSubmit={event => void updateReturn(event, request)}>
            <label>Next return status<select name="new_status">{allowed.map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Customer update<textarea name="notes" required minLength={2} maxLength={2000} /></label>
            <button className="button button-dark" disabled={working === `return-${request.id}`}>Save return update</button>
          </form>}
        </article>;
      })}
    </details>

    <details className="delivery-admin-section" open>
      <summary>Supplier fulfilment, parcels and tracking ({fulfilments.length})</summary>
      {fulfilments.length === 0 ? <p className="account-empty">No HopNShop fulfilments are available.</p> : fulfilments.map(item => {
        const itemShipments = shipments.filter(shipment => shipment.fulfilment_id === item.id);
        const itemParcels = parcels.filter(parcel => parcel.fulfilment_id === item.id);
        const allowed = item.route === 'direct_supplier' && item.status === 'supplier_dispatched'
          ? ['courier_assigned']
          : fulfilmentTransitions[item.status] ?? [];
        const availableAreas = serviceAreas.filter(area => area.locality_id === item.delivery_locality_id && area.active);
        return <article className="admin-request delivery-fulfilment" key={item.id}>
          <div className="account-card-heading"><strong>{item.order_number} · {item.description} × {item.quantity}</strong><span>{item.status.replaceAll('_', ' ')}</span></div>
          <p>Supplier: {item.supplier_name} · Route: {item.route.replaceAll('_', ' ')} · Order: {item.order_status.replaceAll('_', ' ')}</p>
          {item.route !== item.recommended_route && <p>Route override: {item.route_override_reason || 'reason unavailable'}</p>}
          {canManageConfiguration && item.order_status === 'awaiting_payment' && <form className="admin-order-form" onSubmit={event => void requestFeeChange(event, item)}>
            <h4>Request customer approval for a changed delivery fee</h4>
            <p>Current order total: {item.currency.toUpperCase()} {Number(item.order_total).toLocaleString()} · current delivery fee: {item.currency.toUpperCase()} {Number(item.delivery_fee ?? 0).toLocaleString()}</p>
            <label>Requested delivery fee ({item.currency.toUpperCase()})<input name="requested_fee" type="number" min="0" max="100000000" step="0.01" required defaultValue={Number(item.delivery_fee ?? 0)} /></label>
            <label>Reason<textarea name="reason" required minLength={10} maxLength={1000} /></label>
            <button className="button button-dark" disabled={working === `fee-${item.order_id}`}>Request customer approval</button>
          </form>}

          {canManageConfiguration && (item.status === 'awaiting_payment' || item.status === 'procurement_pending') && <form className="admin-order-form" onSubmit={event => void overrideRoute(event, item)}>
            <label>Fulfilment route<select name="route" defaultValue={item.route}><option value="hub">HopNShop hub</option><option value="direct_supplier">Approved direct supplier</option></select></label>
            <label>Reason for route change<textarea name="reason" required minLength={10} maxLength={1000} /></label>
            <button className="button button-dark" disabled={working === `route-${item.id}`}>Save route override</button>
          </form>}

          {allowed.length > 0 && <form className="admin-order-form" onSubmit={event => void transitionFulfilment(event, item)}>
            <label>Next fulfilment status<select name="new_status">{allowed.map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Operational note<textarea name="notes" required minLength={2} maxLength={1000} /></label>
            <button className="button button-dark" disabled={working === `transition-${item.id}`}>Save fulfilment update</button>
          </form>}

          {item.route === 'hub' && ['supplier_processing', 'supplier_dispatched'].includes(item.status) && <form className="admin-order-form" onSubmit={event => void registerIncoming(event, item)}>
            <h4>Register supplier shipment to hub</h4>
            <label>Supplier reference<input name="supplier_reference" maxLength={200} /></label>
            <label>Supplier tracking reference<input name="tracking_reference" required minLength={2} maxLength={200} /></label>
            <label>Dispatch evidence (JPG, PNG, WebP or PDF)<input name="evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label>
            <button className="button button-dark" disabled={working === `incoming-${item.id}`}>Register incoming shipment</button>
          </form>}

          {itemShipments.map(shipment => <div className="admin-request" key={shipment.id}>
            <p>Incoming shipment · {shipment.status.replaceAll('_', ' ')} · {shipment.tracking_reference}</p>
            {shipment.status === 'in_transit' && <button className="button button-dark" onClick={() => void submitRpc(`receive-${shipment.id}`, 'admin_receive_incoming_supplier_shipment', { p_shipment_id: shipment.id, p_discrepancy_notes: null })}>Record received at hub</button>}
            {shipment.status === 'received' && <form className="admin-order-form" onSubmit={event => void inspectIncoming(event, shipment)}>
              <h4>Inspect received items</h4>
              <label>Result<select name="result"><option value="passed">Passed</option><option value="damaged">Damaged</option><option value="missing_items">Missing items</option><option value="other_exception">Other exception</option></select></label>
              <label>Findings<textarea name="findings" required minLength={2} maxLength={2000} /></label>
              <button className="button button-dark" disabled={working === `inspection-${shipment.id}`}>Save inspection</button>
            </form>}
          </div>)}

          {(item.route === 'hub' && item.status === 'ready_to_dispatch' || item.route === 'direct_supplier' && item.status === 'supplier_processing') && <form className="admin-order-form" onSubmit={event => void createParcel(event, item)}>
            <h4>Create customer parcel</h4>
            <label>Active courier service area<select name="service_area_id" required defaultValue=""><option value="" disabled>Choose configured courier service</option>{availableAreas.map(area => {
              const courier = couriers.find(entry => entry.id === area.courier_id);
              const locality = localities.find(entry => entry.id === area.locality_id);
              return <option value={area.id} key={area.id} disabled={!courier?.active}>{courier?.name} · {locality?.town} · {area.service_type}</option>;
            })}</select></label>
            <label>Courier tracking reference<input name="tracking_reference" required minLength={2} maxLength={200} /></label>
            <label>Dispatch evidence (JPG, PNG, WebP or PDF)<input name="evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label>
            <div className="quote-cost-grid"><label>Estimated delivery from<input name="estimated_start" type="date" /></label><label>Estimated delivery to<input name="estimated_end" type="date" /></label></div>
            <button className="button button-dark" disabled={working === `parcel-${item.id}`}>Create parcel and assign order item</button>
          </form>}

          {itemParcels.map(parcel => <div className="admin-request" key={parcel.id}>
            <div className="account-card-heading"><strong>Parcel · {parcel.tracking_reference}</strong><span>{parcel.status.replaceAll('_', ' ')}</span></div>
            {deliveryEvents[parcel.status]?.length > 0 && <form className="admin-order-form" onSubmit={event => void recordParcelEvent(event, parcel)}>
              <label>Next courier event<select name="status">{deliveryEvents[parcel.status].map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
              <label>Tracking update<textarea name="notes" required minLength={2} maxLength={2000} /></label>
              <button className="button button-dark" disabled={working === `event-${parcel.id}`}>Record tracking event</button>
            </form>}
            {parcel.status === 'delivery_attempted' && <form className="admin-order-form" onSubmit={event => void recordAttempt(event, parcel)}>
              <h4>Record delivery attempt details</h4>
              <label>Outcome<select name="outcome"><option value="customer_unavailable">Customer unavailable</option><option value="incorrect_address">Incorrect address</option><option value="access_issue">Access issue</option><option value="damaged">Damaged</option><option value="missing_parcel">Missing parcel</option><option value="other">Other</option></select></label>
              <label>Details<textarea name="notes" required minLength={2} maxLength={2000} /></label>
              <button className="button button-dark" disabled={working === `attempt-${parcel.id}`}>Save attempt</button>
            </form>}
            {['out_for_delivery', 'delivery_attempted'].includes(parcel.status) && <form className="admin-order-form" onSubmit={event => void recordProof(event, parcel)}>
              <h4>Proof of delivery</h4>
              <label>Recipient name<input name="recipient_name" required minLength={2} maxLength={120} /></label>
              <p className="overview-note">Record recipient confirmation only after the courier has confirmed delivery.</p>
              <button className="button button-dark" disabled={working === `proof-${parcel.id}`}>Record recipient confirmation</button>
            </form>}
          </div>)}
        </article>;
      })}
    </details>
  </section>;
}

export default AdminDeliveryManagement;
