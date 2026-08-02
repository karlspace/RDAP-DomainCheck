import type { DomainDetails } from './types.js';

/**
 * Readers for RFC 9083 response objects.
 *
 * Every function here treats its input as hostile JSON from a third party:
 * shapes are checked, arrays are length-capped, and nothing throws. A registry
 * returning nonsense should cost us one dimmed table cell, not a broken run.
 */

/** Defensive caps so one pathological response cannot bloat the UI. */
const MAX_STATUSES = 24;
const MAX_NAMESERVERS = 16;
const MAX_STRING = 200;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, MAX_STRING);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** True when the payload is an RFC 9083 error object rather than a domain. */
export function extractErrorCode(body: unknown): number | null {
  const record = asRecord(body);
  if (record === null) return null;
  const code = record['errorCode'];
  return typeof code === 'number' && Number.isFinite(code) ? code : null;
}

/** True when the payload looks like an RDAP domain object. */
export function isDomainObject(body: unknown): boolean {
  const record = asRecord(body);
  if (record === null) return false;
  if (record['objectClassName'] === 'domain') return true;
  // Not every registry sets objectClassName; a name plus any domain-ish field
  // is enough to recognise the object in practice.
  const hasName =
    typeof record['ldhName'] === 'string' || typeof record['unicodeName'] === 'string';
  return (
    hasName &&
    (Array.isArray(record['events']) ||
      Array.isArray(record['status']) ||
      Array.isArray(record['nameservers']) ||
      typeof record['handle'] === 'string')
  );
}

/** Reads `events[].eventDate` for a given `eventAction`, case-insensitively. */
function findEventDate(events: unknown[], action: string): string | undefined {
  for (const event of events) {
    const record = asRecord(event);
    if (record === null) continue;
    const eventAction = record['eventAction'];
    if (typeof eventAction !== 'string' || eventAction.toLowerCase() !== action) continue;
    const date = asTrimmedString(record['eventDate']);
    if (date !== undefined) return date;
  }
  return undefined;
}

/**
 * Pulls the display name out of a jCard (RFC 7095).
 *
 * The structure is `["vcard", [[name, params, type, value], …]]`, which is a
 * lot of nesting for one string — hence the per-level guards.
 */
function readVcardFullName(vcardArray: unknown): string | undefined {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return undefined;

  for (const property of asArray(vcardArray[1])) {
    if (!Array.isArray(property) || property.length < 4) continue;
    if (property[0] !== 'fn') continue;
    const value: unknown = property[3];
    if (typeof value === 'string') return asTrimmedString(value);
    if (Array.isArray(value)) {
      const first = value.find((part) => typeof part === 'string');
      if (typeof first === 'string') return asTrimmedString(first);
    }
  }
  return undefined;
}

interface RegistrarInfo {
  name?: string | undefined;
  ianaId?: string | undefined;
}

/** Finds the registrar entity, descending one level into nested entities. */
function findRegistrar(entities: unknown[], depth = 0): RegistrarInfo {
  for (const entity of entities) {
    const record = asRecord(entity);
    if (record === null) continue;

    const roles = asArray(record['roles']).filter(
      (role): role is string => typeof role === 'string',
    );
    if (roles.some((role) => role.toLowerCase() === 'registrar')) {
      const publicIds = asArray(record['publicIds']);
      let ianaId: string | undefined;
      for (const publicId of publicIds) {
        const idRecord = asRecord(publicId);
        if (idRecord === null) continue;
        const type = idRecord['type'];
        if (typeof type === 'string' && type.toLowerCase().includes('iana')) {
          ianaId = asTrimmedString(idRecord['identifier']);
          break;
        }
      }
      return {
        name: readVcardFullName(record['vcardArray']),
        ianaId,
      };
    }

    if (depth < 1) {
      const nested = findRegistrar(asArray(record['entities']), depth + 1);
      if (nested.name !== undefined || nested.ianaId !== undefined) return nested;
    }
  }
  return {};
}

/**
 * Extracts the facts worth showing about a registered domain.
 * Returns `null` when the payload is not a domain object.
 */
export function extractDomainDetails(body: unknown): DomainDetails | null {
  const record = asRecord(body);
  if (record === null || !isDomainObject(body)) return null;

  const events = asArray(record['events']);

  const statuses = asArray(record['status'])
    .filter((status): status is string => typeof status === 'string')
    .map((status) => status.trim())
    .filter((status) => status.length > 0)
    .slice(0, MAX_STATUSES);

  const nameservers = asArray(record['nameservers'])
    .map((nameserver) => {
      const nsRecord = asRecord(nameserver);
      if (nsRecord === null) return undefined;
      return asTrimmedString(nsRecord['ldhName']) ?? asTrimmedString(nsRecord['unicodeName']);
    })
    .filter((name): name is string => name !== undefined)
    .slice(0, MAX_NAMESERVERS);

  const secureDns = asRecord(record['secureDNS']);
  const delegationSigned = secureDns?.['delegationSigned'];

  const registrar = findRegistrar(asArray(record['entities']));

  return {
    handle: asTrimmedString(record['handle']),
    registrar: registrar.name,
    registrarIanaId: registrar.ianaId,
    registered: findEventDate(events, 'registration'),
    updated: findEventDate(events, 'last changed') ?? findEventDate(events, 'last update'),
    expires: findEventDate(events, 'expiration'),
    statuses,
    nameservers,
    dnssec: typeof delegationSigned === 'boolean' ? delegationSigned : undefined,
  };
}

/**
 * EPP states meaning the name is not registrable even though it exists, and
 * states that mean it is on its way back to the pool.
 */
const RESERVED_STATUSES = new Set(['reserved', 'blocked', 'excluded', 'withheld']);
const DROPPING_STATUSES = new Set([
  'pending delete',
  'pendingdelete',
  'redemption period',
  'redemptionperiod',
]);

function normalizeStatus(status: string): string {
  return status
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .trim();
}

/** True when the registry says the name exists but cannot be registered. */
export function hasReservedStatus(statuses: readonly string[]): boolean {
  return statuses.some((status) => RESERVED_STATUSES.has(normalizeStatus(status)));
}

/** True when the name is in the deletion pipeline and will drop back to free. */
export function isDropping(statuses: readonly string[]): boolean {
  return statuses.some((status) => {
    const normalized = normalizeStatus(status);
    return DROPPING_STATUSES.has(normalized) || normalized.replace(/ /g, '') === 'pendingdelete';
  });
}
