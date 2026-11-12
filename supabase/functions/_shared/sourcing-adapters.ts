import { z } from 'https://esm.sh/zod@4.1.8';

const listingSchema = z.object({
  name: z.string().trim().min(1).max(300),
  source_url: z.string().url().max(2_000),
  supplier_price: z.coerce.number().finite().positive(),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()),
  brand: z.string().trim().max(200).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  specifications: z.record(z.string(), z.union([z.string().max(500), z.number().finite(), z.null()])).default({}),
  variant: z.string().trim().max(200).nullable().optional(),
  product_condition: z.string().trim().max(100).nullable().optional(),
  supplier_location: z.string().trim().max(200).nullable().optional(),
  image_url: z.string().url().max(2_000).nullable().optional(),
  availability_information: z.string().trim().max(500).nullable().optional(),
  seller_rating: z.coerce.number().finite().min(0).max(5).nullable().optional()
}).passthrough();

const catalogResponseSchema = z.object({
  products: z.array(listingSchema).max(100)
}).passthrough();

export type SupplierListing = z.infer<typeof listingSchema>;
const maxResponseBytes = 5_000_000;

async function readLimitedJson(response: Response): Promise<unknown> {
  if (!response.body) {
    throw new SupplierAdapterError('invalid_provider_response', 'Supplier catalogue returned an empty response.', false);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel();
        throw new SupplierAdapterError('provider_response_too_large', 'Supplier catalogue response exceeded the size limit.', false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SupplierAdapterError('invalid_provider_response', 'Supplier catalogue returned invalid JSON.', false);
  }
}

export class SupplierAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'SupplierAdapterError';
  }
}

export interface SupplierAdapter {
  readonly key: string;
  search(query: string): Promise<SupplierListing[]>;
}

export function isPublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname === '::1'
    || hostname.startsWith('[')
  ) return false;

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      [a, b, Number(ipv4[3]), Number(ipv4[4])].some(part => part > 255)
      || a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
    ) return false;
  }
  return true;
}

function configuredEndpoint() {
  const endpointValue = Deno.env.get('SUPPLIER_CATALOG_API_URL');
  const apiKey = Deno.env.get('SUPPLIER_CATALOG_API_KEY');
  const allowedHosts = (Deno.env.get('SUPPLIER_CATALOG_ALLOWED_HOSTS') ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);

  if (!endpointValue || !apiKey || !allowedHosts.length) {
    throw new SupplierAdapterError('provider_not_configured', 'Supplier catalogue credentials or host allowlist are not configured.', false);
  }
  if (!isPublicHttpsUrl(endpointValue)) {
    throw new SupplierAdapterError('invalid_provider_endpoint', 'The configured catalogue endpoint must be a public HTTPS URL.', false);
  }

  const endpoint = new URL(endpointValue);
  if (!allowedHosts.includes(endpoint.hostname.toLowerCase())) {
    throw new SupplierAdapterError('provider_host_not_allowed', 'The configured catalogue host is not in the server allowlist.', false);
  }

  return { endpoint, apiKey };
}

export class JsonCatalogAdapter implements SupplierAdapter {
  readonly key = 'json_catalog';

  async search(query: string) {
    const { endpoint, apiKey } = configuredEndpoint();
    const url = new URL(endpoint);
    url.searchParams.set('q', query.slice(0, 500));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new SupplierAdapterError(
          response.status === 429 ? 'provider_rate_limited' : 'provider_http_error',
          `Supplier catalogue returned HTTP ${response.status}.`,
          response.status === 429 || response.status >= 500
        );
      }

      const lengthHeader = response.headers.get('content-length');
      const length = lengthHeader === null ? 0 : Number(lengthHeader);
      if (Number.isFinite(length) && length > maxResponseBytes) {
        throw new SupplierAdapterError('provider_response_too_large', 'Supplier catalogue response exceeded the size limit.', false);
      }
      const parsed = catalogResponseSchema.safeParse(await readLimitedJson(response));
      if (!parsed.success) {
        throw new SupplierAdapterError('invalid_provider_response', 'Supplier catalogue response did not match the configured JSON contract.', false);
      }

      return parsed.data.products.filter(product =>
        isPublicHttpsUrl(product.source_url)
        && (!product.image_url || isPublicHttpsUrl(product.image_url))
      );
    } catch (error) {
      if (error instanceof SupplierAdapterError) throw error;
      if (controller.signal.aborted) {
        throw new SupplierAdapterError('provider_timeout', 'Supplier catalogue request timed out.', true);
      }
      throw new SupplierAdapterError('provider_unavailable', 'Supplier catalogue could not be reached.', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createSupplierAdapter(adapterKey: string): SupplierAdapter {
  if (adapterKey === 'json_catalog') return new JsonCatalogAdapter();
  throw new SupplierAdapterError('unsupported_adapter', 'The configured supplier adapter is not supported.', false);
}
