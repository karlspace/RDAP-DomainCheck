/**
 * German translations — the source of truth for the key set.
 *
 * `as const` turns this object into the canonical `TranslationKey` union, so
 * every other locale is checked against it at compile time.
 */
export const de = {
  'app.eyebrow': 'RDAP · RFC 9082',
  'app.title': 'Domain-Verfügbarkeit prüfen',
  'app.subtitle':
    'Fragt die zuständigen Registries direkt über RDAP ab — strukturiert statt WHOIS-Freitext. Läuft vollständig im Browser, ohne Backend.',
  'app.skipToContent': 'Zum Inhalt springen',

  'nav.language': 'Sprache',
  'nav.theme': 'Darstellung',
  'theme.light': 'Hell',
  'theme.dark': 'Dunkel',
  'theme.system': 'System',

  'bootstrap.loading': 'Lade IANA-Bootstrap-Registry …',
  'bootstrap.ready': '{iana} TLDs von IANA (Stand {publication}) · {manual} manuell ergänzt',
  'bootstrap.readyNoDate': '{iana} TLDs von IANA · {manual} manuell ergänzt',
  'bootstrap.stale': 'Zwischengespeicherte Registry-Daten in Verwendung (IANA nicht erreichbar)',
  'bootstrap.error': 'IANA-Bootstrap-Registry nicht erreichbar: {message}',
  'bootstrap.retry': 'Erneut laden',

  'input.tab.list': 'Domain-Liste',
  'input.tab.matrix': 'TLD-Matrix',
  'input.list.label': 'Domains (eine pro Zeile)',
  'input.list.placeholder': 'beispiel-firma.de\nbeispiel-firma.com\nprojekt-xy.eu\nmünchen.example',
  'input.list.hint': '{count} Domains erkannt',
  'input.list.hintOne': '1 Domain erkannt',
  'input.list.rejected': '{count} Einträge nicht verwertbar',
  'input.list.truncated': 'Auf {max} Domains begrenzt',
  'input.matrix.namesLabel': 'Namen',
  'input.matrix.namesPlaceholder': 'beispiel-firma\nprojekt-xy',
  'input.matrix.tldsLabel': 'Endungen',
  'input.matrix.tldsPlaceholder': 'de com net eu io',
  'input.matrix.presets': 'Vorlagen',
  'input.matrix.preview': 'Ergibt {count} Kombinationen',

  'action.check': 'Verfügbarkeit prüfen',
  'action.checking': 'Prüfe …',
  'action.cancel': 'Abbrechen',
  'action.clear': 'Leeren',

  'results.title': 'Ergebnisse',
  'results.empty': 'Noch keine Prüfung durchgeführt.',
  'results.emptyFiltered': 'Keine Treffer für diesen Filter.',
  'results.progress': '{done} von {total}',
  'results.cancelled': 'Prüfung abgebrochen.',

  'summary.available': 'Frei',
  'summary.registered': 'Vergeben',
  'summary.inconclusive': 'Unklar',

  'filter.all': 'Alle',
  'filter.search': 'Suchen',
  'filter.searchPlaceholder': 'Domain filtern …',

  'table.domain': 'Domain',
  'table.status': 'Status',
  'table.registrar': 'Registrar',
  'table.expires': 'Läuft ab',
  'table.registry': 'Registry',
  'table.details': 'Details',
  'table.showDetails': 'Details zu {domain} anzeigen',

  'detail.registered': 'Registriert',
  'detail.updated': 'Zuletzt geändert',
  'detail.expires': 'Läuft ab',
  'detail.handle': 'Registry-Handle',
  'detail.registrarId': 'IANA-Registrar-ID',
  'detail.nameservers': 'Nameserver',
  'detail.eppStatus': 'EPP-Status',
  'detail.dnssec': 'DNSSEC',
  'detail.dnssecOn': 'signiert',
  'detail.dnssecOff': 'nicht signiert',
  'detail.httpStatus': 'HTTP-Status',
  'detail.duration': 'Antwortzeit',
  'detail.diagnostic': 'Diagnose',
  'detail.openJson': 'RDAP-JSON öffnen',
  'detail.none': '—',

  'status.pending': 'Wartet',
  'status.running': 'Prüft …',
  'status.available': 'Frei',
  'status.registered': 'Vergeben',
  'status.reserved': 'Reserviert',
  'status.no-registry': 'Kein RDAP',
  'status.rate-limited': 'Rate-Limit',
  'status.blocked': 'Abgelehnt',
  'status.unreachable': 'Nicht erreichbar',
  'status.browser-blocked': 'Manuell prüfen',
  'status.invalid': 'Ungültige Abfrage',
  'status.registry-error': 'Registry-Fehler',
  'status.cancelled': 'Abgebrochen',

  'confidence.label': 'Aussagekraft',
  'confidence.authoritative': 'Verbindliche Auskunft der Registry',
  'confidence.indicative': 'Nur ein Hinweis — bitte manuell gegenprüfen',
  'confidence.unknown': 'Keine belastbare Aussage möglich',

  'badge.dropping': 'wird frei',
  'badge.droppingHint':
    'Domain befindet sich in der Löschphase und wird voraussichtlich wieder frei',

  'warning.possible-subdomain':
    'Sieht nach einer Subdomain aus — die Registry-Antwort gilt dann nicht für eine registrierbare Domain',
  'warning.idn-converted': 'Umlaut-/IDN-Domain, abgefragt wurde die Punycode-Form',
  'warning.manual-registry': 'RDAP-Server stammt aus der manuellen Ergänzungsliste, nicht von IANA',
  'warning.registry-blocks-browser':
    'Diese Registry erlaubt keine Abfrage aus dem Browser (kein CORS-Header). Die Antwort ist korrekt, nur nicht auslesbar — über „RDAP-JSON öffnen" direkt prüfen.',
  'warning.stale-bootstrap': 'Basiert auf zwischengespeicherten IANA-Daten',
  'warning.unexpected-payload': 'Registry antwortete mit unerwartetem Inhalt',

  'export.csv': 'CSV',
  'export.json': 'JSON',
  'export.copyAvailable': 'Freie kopieren',
  'export.copied': 'Kopiert',
  'export.failed': 'Kopieren fehlgeschlagen',

  'footer.privacy':
    'Alle Abfragen laufen direkt vom Browser zur jeweiligen Registry. Es gibt kein Backend, kein Tracking und keine Analyse.',
  'footer.cors':
    'Einzelne Registries — darunter DENIC für .de — erlauben keine Abfragen aus dem Browser. Solche Domains werden als „Manuell prüfen" markiert und direkt zur RDAP-Antwort verlinkt.',
  'footer.source': 'Quellcode',
  'footer.version': 'Version {version}',
} as const;
