import type { BootstrapService } from './types.js';
import { AbortError, KeyedLimiter, delay } from './pool.js';

/** Why a request produced no HTTP status at all. */
export type RdapFailureKind = 'network' | 'timeout' | 'aborted';

/** Raw outcome of one RDAP exchange, before it is interpreted. */
export interface RdapResponse {
  /** The URL that was actually queried. Always HTTPS. */
  readonly url: string;
  readonly httpStatus: number | null;
  /** Parsed JSON body, or `null` when absent, oversized or unparseable. */
  readonly body: unknown;
  readonly failure: RdapFailureKind | null;
  /** Short technical note for diagnostics; never HTML. */
  readonly diagnostic: string | null;
  readonly durationMs: number;
  readonly attempts: number;
}

export const DEFAULT_TIMEOUT_MS = 12_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_PER_ORIGIN_CONCURRENCY = 2;

const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 8_000;
/** Never idle longer than this because a registry asked us to. */
const RETRY_AFTER_CAP_MS = 15_000;
/** Refuse to parse absurd payloads — a hostile registry should not exhaust us. */
const MAX_BODY_CHARS = 1_048_576;

/** Transient conditions worth a second attempt. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Parses `Retry-After` in both delta-seconds and HTTP-date form. */
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null;

  const trimmed = header.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, RETRY_AFTER_CAP_MS);
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return null;

  return Math.min(Math.max(timestamp - now, 0), RETRY_AFTER_CAP_MS);
}

/** Exponential backoff with full jitter, so retries do not re-synchronise. */
export function backoffDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
  return Math.round(ceiling * random());
}

export interface RdapClientOptions {
  readonly timeoutMs?: number | undefined;
  readonly maxAttempts?: number | undefined;
  readonly perOriginConcurrency?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => number) | undefined;
}

/**
 * Talks to RDAP registries: timeouts, bounded retries with jittered backoff,
 * per-origin rate limiting and failover to a registry's alternate base URLs.
 *
 * The client deliberately does **not** interpret responses — that lives in
 * `classify.ts`, so the network policy and the availability policy can be
 * reviewed, tested and changed independently.
 */
export class RdapClient {
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;
  readonly #now: () => number;
  readonly #limiter: KeyedLimiter;

  constructor(options: RdapClientOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#sleep = options.sleep ?? delay;
    this.#random = options.random ?? Math.random;
    this.#now = options.now ?? Date.now;
    this.#limiter = new KeyedLimiter(
      Math.max(1, options.perOriginConcurrency ?? DEFAULT_PER_ORIGIN_CONCURRENCY),
    );
  }

  /** Builds the RFC 9082 domain lookup path for a registry base URL. */
  static buildQueryUrl(baseUrl: string, asciiDomain: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/domain/${encodeURIComponent(asciiDomain)}`;
  }

  /**
   * Queries the registry for one domain.
   *
   * Tries the service's base URLs in order; a URL is abandoned only on a
   * transport-level failure, never on a valid HTTP answer — a 404 from the
   * first registry URL is the answer, not a reason to ask a second one.
   */
  async lookupDomain(
    asciiDomain: string,
    service: BootstrapService,
    signal?: AbortSignal,
  ): Promise<RdapResponse> {
    let last: RdapResponse | null = null;

    for (const baseUrl of service.urls) {
      const response = await this.#lookupAt(baseUrl, asciiDomain, signal);
      if (response.httpStatus !== null || response.failure === 'aborted') return response;
      last = response;
    }

    return (
      last ?? {
        url: RdapClient.buildQueryUrl(service.urls[0] ?? '', asciiDomain),
        httpStatus: null,
        body: null,
        failure: 'network',
        diagnostic: 'No usable registry URL',
        durationMs: 0,
        attempts: 0,
      }
    );
  }

  async #lookupAt(
    baseUrl: string,
    asciiDomain: string,
    signal?: AbortSignal,
  ): Promise<RdapResponse> {
    const url = RdapClient.buildQueryUrl(baseUrl, asciiDomain);
    const started = this.#now();
    const originKey = originOf(baseUrl);

    const release = await this.#limiter.acquire(originKey);
    try {
      let attempts = 0;

      while (attempts < this.#maxAttempts) {
        attempts += 1;

        if (signal?.aborted === true) {
          return this.#failure(url, 'aborted', 'Cancelled', started, attempts);
        }

        const attempt = await this.#attempt(url, signal);

        if (attempt.kind === 'failure') {
          if (attempt.failure === 'aborted') {
            return this.#failure(url, 'aborted', attempt.diagnostic, started, attempts);
          }
          if (attempts >= this.#maxAttempts) {
            return this.#failure(url, attempt.failure, attempt.diagnostic, started, attempts);
          }
          if (!(await this.#waitBeforeRetry(backoffDelay(attempts, this.#random), signal))) {
            return this.#failure(url, 'aborted', 'Cancelled', started, attempts);
          }
          continue;
        }

        const { response } = attempt;
        const retryable = RETRYABLE_STATUS.has(response.status);

        if (retryable && attempts < this.#maxAttempts) {
          const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), this.#now());
          const waitMs = retryAfter ?? backoffDelay(attempts, this.#random);
          if (!(await this.#waitBeforeRetry(waitMs, signal))) {
            return this.#failure(url, 'aborted', 'Cancelled', started, attempts);
          }
          continue;
        }

        const { body, diagnostic } = await readJsonBody(response);
        return {
          url,
          httpStatus: response.status,
          body,
          failure: null,
          diagnostic,
          durationMs: this.#now() - started,
          attempts,
        };
      }

      return this.#failure(url, 'network', 'Retries exhausted', started, attempts);
    } finally {
      release();
    }
  }

  async #attempt(
    url: string,
    signal?: AbortSignal,
  ): Promise<
    | { kind: 'response'; response: Response }
    | { kind: 'failure'; failure: RdapFailureKind; diagnostic: string }
  > {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/rdap+json' },
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: combined,
      });
      return { kind: 'response', response };
    } catch (error) {
      if (signal?.aborted === true) {
        return { kind: 'failure', failure: 'aborted', diagnostic: 'Cancelled' };
      }
      if (timeout.aborted) {
        return {
          kind: 'failure',
          failure: 'timeout',
          diagnostic: `Timeout after ${String(this.#timeoutMs)} ms`,
        };
      }
      return { kind: 'failure', failure: 'network', diagnostic: describeError(error) };
    }
  }

  /** Returns `false` when the wait was cancelled. */
  async #waitBeforeRetry(ms: number, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.#sleep(ms, signal);
      return true;
    } catch (error) {
      if (error instanceof AbortError) return false;
      return false;
    }
  }

  #failure(
    url: string,
    failure: RdapFailureKind,
    diagnostic: string,
    started: number,
    attempts: number,
  ): RdapResponse {
    return {
      url,
      httpStatus: null,
      body: null,
      failure,
      diagnostic,
      durationMs: this.#now() - started,
      attempts,
    };
  }
}

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Browsers report CORS rejections as an opaque "Failed to fetch"; naming
    // the likely cause saves the next person a long debugging detour.
    return error.name === 'TypeError'
      ? `${error.message} (likely CORS or DNS)`
      : `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** Reads a JSON body defensively: size-capped, content-type aware, never throws. */
async function readJsonBody(
  response: Response,
): Promise<{ body: unknown; diagnostic: string | null }> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType !== '' && !contentType.toLowerCase().includes('json')) {
    return { body: null, diagnostic: `Unexpected Content-Type: ${contentType.slice(0, 80)}` };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { body: null, diagnostic: describeError(error) };
  }

  if (text.length === 0) return { body: null, diagnostic: null };
  if (text.length > MAX_BODY_CHARS) {
    return { body: null, diagnostic: 'Response body too large' };
  }

  try {
    return { body: JSON.parse(text) as unknown, diagnostic: null };
  } catch {
    return { body: null, diagnostic: 'Response body is not valid JSON' };
  }
}
