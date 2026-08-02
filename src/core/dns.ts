/**
 * DNS-over-HTTPS fallback for registries that block browser access.
 *
 * This exists for exactly one inference, and it is a sound one:
 *
 *     the name has NS records  ⟹  the name is delegated  ⟹  it is registered
 *
 * Delegation only exists for registered names, so a positive answer here cannot
 * be wrong. The converse does *not* hold — a registered domain need not be
 * delegated (freshly registered, parked, defensively held, mid-transfer), so
 * "no NS records" says nothing about availability.
 *
 * That asymmetry is encoded in {@link DelegationStatus}: there is no
 * `not-delegated` value. NXDOMAIN, a timeout and a malformed answer all collapse
 * into `unknown`, which makes the unsound conclusion unrepresentable rather
 * than merely discouraged.
 *
 * Privacy note: using this sends the queried name to a third-party resolver,
 * which is why it is opt-in and off by default. Everything else in this app
 * talks only to the registry responsible for the TLD.
 */

/** Cloudflare's DoH endpoint. Documented no-logging policy, 24 h retention. */
export const CLOUDFLARE_DOH_URL = 'https://cloudflare-dns.com/dns-query';

export const DEFAULT_DNS_TIMEOUT_MS = 6_000;

/** DNS RCODE for "no error" (RFC 1035 §4.1.1). */
const RCODE_NOERROR = 0;
/** RR type for NS records. */
const RR_TYPE_NS = 2;

const MAX_NAMESERVERS = 16;

export type DelegationStatus = 'delegated' | 'unknown';

export interface DelegationResult {
  readonly status: DelegationStatus;
  /** Name servers found, for display. Empty unless `status` is `delegated`. */
  readonly nameservers: readonly string[];
  /** Short technical note; never rendered as HTML. */
  readonly diagnostic: string | null;
}

const UNKNOWN = (diagnostic: string | null): DelegationResult => ({
  status: 'unknown',
  nameservers: [],
  diagnostic,
});

export interface DohResolverOptions {
  readonly url?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

/** Reads a DoH JSON answer defensively; third-party JSON gets no more trust
 *  than registry JSON does. */
function extractNameservers(payload: unknown): string[] | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const record = payload as Record<string, unknown>;
  if (record['Status'] !== RCODE_NOERROR) return null;

  const answers = record['Answer'];
  if (!Array.isArray(answers)) return null;

  const nameservers: string[] = [];
  for (const answer of answers) {
    if (typeof answer !== 'object' || answer === null) continue;
    const entry = answer as Record<string, unknown>;
    if (entry['type'] !== RR_TYPE_NS) continue;
    const data = entry['data'];
    if (typeof data !== 'string' || data.length === 0) continue;
    nameservers.push(data.replace(/\.$/, '').slice(0, 200));
    if (nameservers.length >= MAX_NAMESERVERS) break;
  }

  return nameservers.length > 0 ? nameservers : null;
}

/** Queries a DoH resolver for the NS RRset of a name. */
export class DohResolver {
  readonly #url: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: DohResolverOptions = {}) {
    this.#url = options.url ?? CLOUDFLARE_DOH_URL;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async lookupDelegation(asciiDomain: string, signal?: AbortSignal): Promise<DelegationResult> {
    if (signal?.aborted === true) return UNKNOWN('Cancelled');

    const url = `${this.#url}?name=${encodeURIComponent(asciiDomain)}&type=NS`;
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/dns-json' },
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: combined,
      });
    } catch (error) {
      return UNKNOWN(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }

    if (!response.ok) return UNKNOWN(`HTTP ${String(response.status)}`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return UNKNOWN('Resolver answer is not valid JSON');
    }

    const nameservers = extractNameservers(payload);
    if (nameservers === null) {
      // Includes NXDOMAIN. Deliberately not reported as "free": see module docs.
      return UNKNOWN('No NS records — says nothing about registration');
    }

    return { status: 'delegated', nameservers, diagnostic: null };
  }
}
