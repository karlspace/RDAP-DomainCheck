import type { Confidence, DomainDetails, RowStatus, WarningCode } from './types.js';
import type { RdapResponse } from './rdap.js';
import { extractDomainDetails, extractErrorCode, hasReservedStatus } from './rdap-response.js';

/**
 * Availability policy: what an RDAP exchange actually *means*.
 *
 * This is the fachliche Kernentscheidung of the whole tool and it is
 * deliberately the only place that makes it. Two rules guide it:
 *
 *  1. **Never claim "free" on ambiguity.** A false "registered" costs a user one
 *     manual re-check; a false "free" costs them a naming decision, a logo and a
 *     trademark filing built on a domain they can never have.
 *  2. **Say how sure we are.** Everything that is not a clean answer from the
 *     authoritative registry is reported as `indicative` or `unknown`, and the
 *     UI renders that difference instead of hiding it.
 */

export interface Classification {
  readonly status: RowStatus;
  readonly confidence: Confidence;
  readonly details: DomainDetails | null;
  readonly warnings: readonly WarningCode[];
  readonly diagnostic: string | null;
}

/**
 * HTTP status → availability, per RFC 9083 §5 and the ICANN RDAP Response
 * Profile. Anything not listed falls through to `registry-error`.
 */
function fromHttpStatus(status: number): { status: RowStatus; confidence: Confidence } {
  switch (status) {
    // The registry is authoritative for its own namespace, so "not found"
    // really does mean the name is unregistered.
    case 404:
      return { status: 'available', confidence: 'authoritative' };
    case 400:
    case 422:
      return { status: 'invalid', confidence: 'unknown' };
    case 403:
    case 451:
      return { status: 'blocked', confidence: 'unknown' };
    case 429:
      return { status: 'rate-limited', confidence: 'unknown' };
    default:
      return { status: 'registry-error', confidence: 'unknown' };
  }
}

/** Interprets one raw RDAP exchange. Pure: same input, same verdict. */
export function classifyResponse(response: RdapResponse): Classification {
  if (response.failure !== null) {
    if (response.failure === 'aborted') {
      return empty('cancelled', 'unknown', response.diagnostic);
    }
    return empty('unreachable', 'unknown', response.diagnostic);
  }

  const httpStatus = response.httpStatus;
  if (httpStatus === null) {
    return empty('registry-error', 'unknown', response.diagnostic);
  }

  // Some registries answer 200 with an RDAP *error* object instead of using the
  // HTTP status. The embedded code is the real answer in that case.
  const errorCode = extractErrorCode(response.body);
  if (errorCode !== null) {
    const mapped = fromHttpStatus(errorCode);
    return empty(mapped.status, mapped.confidence, response.diagnostic);
  }

  if (httpStatus === 200) {
    const details = extractDomainDetails(response.body);

    if (details === null) {
      // A 200 without a recognisable domain object: the name is clearly known
      // to the registry, but we cannot say more than that.
      return {
        status: 'registered',
        confidence: 'indicative',
        details: null,
        warnings: ['unexpected-payload'],
        diagnostic: response.diagnostic,
      };
    }

    const status: RowStatus = hasReservedStatus(details.statuses) ? 'reserved' : 'registered';
    return {
      status,
      confidence: 'authoritative',
      details,
      warnings: [],
      diagnostic: response.diagnostic,
    };
  }

  const mapped = fromHttpStatus(httpStatus);
  return empty(mapped.status, mapped.confidence, response.diagnostic);
}

function empty(
  status: RowStatus,
  confidence: Confidence,
  diagnostic: string | null,
): Classification {
  return { status, confidence, details: null, warnings: [], diagnostic };
}

/** Statuses a user would call "a definite answer". Drives the summary counts. */
export function isConclusive(status: RowStatus): boolean {
  return status === 'available' || status === 'registered' || status === 'reserved';
}
