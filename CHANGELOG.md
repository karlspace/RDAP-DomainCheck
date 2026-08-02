## [1.1.1](https://github.com/karlspace/RDAP-DomainCheck/compare/v1.1.0...v1.1.1) (2026-08-02)

### 🐛 Bug Fixes

* corrected layout faults found by looking at the page ([df632fe](https://github.com/karlspace/RDAP-DomainCheck/commit/df632fedbc401bafa40975f3ecb7e86f8fbdc67c))

## [1.1.0](https://github.com/karlspace/RDAP-DomainCheck/compare/v1.0.2...v1.1.0) (2026-08-02)

### 🚀 Features

* added optional DNS pre-check for blocked registries ([2029c9c](https://github.com/karlspace/RDAP-DomainCheck/commit/2029c9c067166a08093dda2733de3ebacb1bb545))

## [1.0.2](https://github.com/karlspace/RDAP-DomainCheck/compare/v1.0.1...v1.0.2) (2026-08-02)

### 🐛 Bug Fixes

* reported CORS-blocked registries as such, not unreachable ([e50ede4](https://github.com/karlspace/RDAP-DomainCheck/commit/e50ede412661cade8dbe6f8f7486cd1d93d0455e))

## [1.0.1](https://github.com/karlspace/RDAP-DomainCheck/compare/v1.0.0...v1.0.1) (2026-08-02)

### 🐛 Bug Fixes

* **ci:** excluded generated changelog from format check ([736f010](https://github.com/karlspace/RDAP-DomainCheck/commit/736f010a7c9e4f67c5ef1a3e383df0544612b566))
* **ci:** validated pull requests without the shared workflow ([60bba04](https://github.com/karlspace/RDAP-DomainCheck/commit/60bba0455797ac1a0ee33983a37b8a729a4de9eb))

## 1.0.0 (2026-08-02)

### 🚀 Features

* implemented RDAP domain checker ([75b22dc](https://github.com/karlspace/RDAP-DomainCheck/commit/75b22dc7d65daf720afaa47d64c481d9114ff02c))

### 🐛 Bug Fixes

* stopped debounce from leaking across app instances ([a4c8ca1](https://github.com/karlspace/RDAP-DomainCheck/commit/a4c8ca120e8430e75f5bb70be7d01f29109a63e1))

# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung an [Semantic Versioning](https://semver.org/lang/de/).

## [1.0.0] — 2026-08-02

Erste produktive Version. Der Prototyp (eine `index.html` mit Inline-Skript) wurde vollständig
neu aufgebaut.

### Hinzugefügt

- **TLD-Matrix** — einen Namen gegen viele Endungen prüfen, mit Vorlagen für DACH, Global, EU,
  Tech und Shop.
- **RDAP-Details je Domain** — Registrar, IANA-Registrar-ID, Registrierungs-, Änderungs- und
  Ablaufdatum, EPP-Status, Nameserver, DNSSEC und Registry-Handle in einer aufklappbaren Zeile.
- **Aussagekraft je Ergebnis** (verbindlich / Hinweis / keine Aussage) statt eines undifferenzierten
  „Unklar".
- **Warnhinweise** für vermutete Subdomains, IDN-Umwandlung, manuell ergänzte Registries,
  veraltete Bootstrap-Daten und unerwartete Antwortinhalte.
- **Hinweis „wird frei"** für Domains in `pendingDelete` oder `redemptionPeriod`.
- **Filter und Suche** über Status, Domain und Registrar.
- **Export als CSV und JSON** (Download statt nur Zwischenablage) sowie „freie Domains kopieren".
- **Abbrechen** laufender Prüfungen.
- **Deutsch und Englisch** umschaltbar, Vorauswahl nach Browsersprache.
- **Hell/Dunkel/System-Theme**, folgt Systemwechseln live.
- **Zustandserhalt** für Eingaben, Sprache und Theme über `localStorage`.
- **IDN-Unterstützung** — `münchen.de` wird als `xn--mnchen-3ya.de` abgefragt, angezeigt bleibt die
  eingegebene Form.
- **Nachvollziehbarer Bootstrap-Status** inklusive Hinweis auf zwischengespeicherte Daten.
- **282 Unit-Tests** bei 94 % Statement-Coverage, CI und automatisches Pages-Deployment.

### Geändert

- **Architektur** — von einer Datei zu getrennten, testbaren Modulen in TypeScript; die
  Verfügbarkeits-Policy liegt isoliert in `src/core/classify.ts`.
- **Registry-Zuordnung** per Longest-Suffix-Match nach RFC 7484 statt Auswertung nur des letzten
  Labels. `acme.co.uk` trifft dadurch die richtige Registry.
- **Bootstrap-Registry** wird 24 Stunden zwischengespeichert; fällt IANA aus, arbeitet das Werkzeug
  mit den zwischengespeicherten Daten weiter und weist darauf hin.
- **Manuelle Registry-Ergänzungen** füllen jetzt nur noch Lücken. Sobald IANA einen Suffix führt,
  gewinnt IANA — eine veraltete URL kann sich so nicht dauerhaft festsetzen.
- **Nebenläufigkeit** mit globalem Limit _und_ Limit je Registry, statt eines einzelnen globalen
  Werts. Gemischte Listen laufen dadurch schneller und lösen seltener Rate-Limits aus.
- **Domain-Erkennung** akzeptiert URLs, E-Mail-Adressen, Wildcards und Aufzählungszeichen und meldet
  nicht verwertbare Einträge, statt sie stillschweigend zu verwerfen.

### Behoben

- **XSS-Risiko:** Registry-Daten und Registry-URLs wurden per `innerHTML` in die Seite geschrieben.
  Eine manipulierte Bootstrap-Datei hätte über eine `javascript:`-URL Code ausführen können.
- **Fehlende Fehlerbehandlung** bei HTTP 429, 5xx und Zeitüberschreitungen — jetzt mit begrenzten
  Wiederholungen, Backoff mit Jitter und Auswertung von `Retry-After`.
- **Falsch positives „frei"** bei Subdomain-Eingaben wird jetzt als Hinweis gekennzeichnet.
- **Formel-Injection** im CSV-Export (CWE-1236).

### Sicherheit

- Strikte Content-Security-Policy im Produktions-Build inklusive Trusted Types.
- **Google Fonts entfernt.** Die Einbindung per `@import` von `fonts.googleapis.com` übertrug die
  IP-Adresse jedes Besuchers ohne Einwilligung an Google (LG München I, 3 O 17493/20). Ersetzt durch
  den System-Font-Stack.
- `referrer: no-referrer` und `credentials: 'omit'` für alle Anfragen.
- Registry-URLs werden ausschließlich mit `https:` akzeptiert; eingebettete Zugangsdaten werden
  abgelehnt.
- Größen- und Längenbegrenzungen für alle Fremddaten.

[1.0.0]: https://github.com/karlspace/RDAP-DomainCheck/releases/tag/v1.0.0
