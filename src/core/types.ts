/**
 * Shared domain model.
 *
 * Everything the app knows about a domain check flows through these types.
 * They are deliberately free of DOM references so the whole core layer stays
 * unit-testable in a plain Node environment.
 */

/** Outcome of interpreting a single RDAP lookup. */
export type Availability =
  /** Registry answered authoritatively that the object does not exist. */
  | 'available'
  /** Registry returned a domain object. */
  | 'registered'
  /** Registry knows the name but it is withheld from registration. */
  | 'reserved'
  /** No RDAP service is published for this TLD. */
  | 'no-registry'
  /** Registry throttled us and kept doing so after all retries. */
  | 'rate-limited'
  /** Registry refused the query (403 / 451). */
  | 'blocked'
  /** Network failure, CORS rejection, DNS failure or timeout. */
  | 'unreachable'
  /** Registry rejected the query as malformed (400 / 422). */
  | 'invalid'
  /** Registry answered, but with a server-side failure (5xx) or garbage. */
  | 'registry-error';

/** Availability plus the transient states the table needs while working. */
export type RowStatus = Availability | 'pending' | 'running' | 'cancelled';

/**
 * How much trust the result deserves.
 * `available` from a registry that answered 404 is authoritative;
 * anything derived from a failed or ambiguous exchange is not.
 */
export type Confidence = 'authoritative' | 'indicative' | 'unknown';

/** Machine-readable hints shown next to a row; rendered via i18n. */
export type WarningCode =
  /** More labels than the matched public suffix implies — likely a subdomain. */
  | 'possible-subdomain'
  /** Input contained non-ASCII and was converted to punycode. */
  | 'idn-converted'
  /** Registry URL came from our manual override table, not from IANA. */
  | 'manual-registry'
  /** The IANA bootstrap data in use is a stale cached copy. */
  | 'stale-bootstrap'
  /** Registry answered 200 but the payload did not look like a domain object. */
  | 'unexpected-payload';

/** A domain after normalisation: what we query vs. what we show. */
export interface NormalizedDomain {
  /** Punycode / LDH form actually sent to the registry. */
  readonly ascii: string;
  /** Human-readable form as typed (unicode preserved). */
  readonly display: string;
  /** True when `ascii` differs from `display` because of IDN conversion. */
  readonly isIdn: boolean;
}

/** Structured facts extracted from a registered domain's RDAP response. */
export interface DomainDetails {
  readonly handle?: string | undefined;
  readonly registrar?: string | undefined;
  readonly registrarIanaId?: string | undefined;
  /** ISO-8601 timestamps, exactly as delivered by the registry. */
  readonly registered?: string | undefined;
  readonly updated?: string | undefined;
  readonly expires?: string | undefined;
  /** EPP status codes, e.g. `clientTransferProhibited`. */
  readonly statuses: readonly string[];
  readonly nameservers: readonly string[];
  readonly dnssec?: boolean | undefined;
}

/** One row of the result table. */
export interface CheckResult {
  readonly domain: NormalizedDomain;
  /** Public suffix matched in the bootstrap registry (e.g. `de`, `co.uk`). */
  readonly suffix: string | null;
  readonly status: RowStatus;
  readonly confidence: Confidence;
  /** Base URL of the RDAP service used, without trailing slash. */
  readonly registry?: string | undefined;
  /** Full RDAP query URL — safe to open in a new tab. */
  readonly queryUrl?: string | undefined;
  readonly httpStatus?: number | undefined;
  readonly details?: DomainDetails | undefined;
  readonly warnings: readonly WarningCode[];
  readonly durationMs?: number | undefined;
  /** Technical detail for the tooltip; never rendered as HTML. */
  readonly diagnostic?: string | undefined;
}

/** One entry of the RFC 7484 bootstrap registry after validation. */
export interface BootstrapService {
  /** Suffix this service is authoritative for, lowercase, no leading dot. */
  readonly suffix: string;
  /** HTTPS base URLs, without trailing slash, in registry preference order. */
  readonly urls: readonly string[];
  readonly origin: 'iana' | 'manual';
}

/** The validated, queryable bootstrap registry. */
export interface BootstrapRegistry {
  /** Suffix -> service. Keys are lowercase ASCII. */
  readonly services: ReadonlyMap<string, BootstrapService>;
  /** `publication` field from IANA, if present. */
  readonly publication: string | null;
  /** How many suffixes came from our manual override table. */
  readonly manualCount: number;
  /** When this data was fetched (epoch ms). */
  readonly fetchedAt: number;
  /** True when served from cache because the network fetch failed. */
  readonly stale: boolean;
}
