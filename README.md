# RDAP Domain-Check

Massen-Prüfung von Domain-Verfügbarkeit über **RDAP** statt WHOIS — vollständig im Browser,
ohne Backend, ohne Tracking.

**Live:** <https://karlspace.github.io/RDAP-DomainCheck/>

[![PR](https://github.com/karlspace/RDAP-DomainCheck/actions/workflows/pr.yml/badge.svg)](https://github.com/karlspace/RDAP-DomainCheck/actions/workflows/pr.yml)
[![Release](https://github.com/karlspace/RDAP-DomainCheck/actions/workflows/release.yml/badge.svg)](https://github.com/karlspace/RDAP-DomainCheck/actions/workflows/release.yml)
[![Pages](https://github.com/karlspace/RDAP-DomainCheck/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/karlspace/RDAP-DomainCheck/actions/workflows/deploy-pages.yml)

---

## Warum RDAP

WHOIS liefert unstrukturierten Freitext, der sich je Registry unterscheidet, und ist stark
rate-limitiert. RDAP (Registration Data Access Protocol, RFC 7480–7484 / 9082 / 9083) ist der
offizielle Nachfolger: HTTPS, JSON, definierte Statuscodes und ein von IANA gepflegtes Verzeichnis,
welche Registry für welche TLD zuständig ist.

Konkret heißt das für dieses Tool:

|                         | WHOIS                | RDAP                      |
| ----------------------- | -------------------- | ------------------------- |
| Antwortformat           | Freitext je Registry | JSON nach RFC 9083        |
| „Domain frei?"          | Textmuster raten     | HTTP 404 vs. 200          |
| Aus dem Browser nutzbar | nein (Port 43)       | ja (HTTPS + CORS)         |
| Registry-Verzeichnis    | keins                | IANA Bootstrap (RFC 7484) |

## Funktionen

- **Domain-Liste** — beliebiges Eingabeformat: eine pro Zeile, Komma, Semikolon, URLs oder
  E-Mail-Adressen. Doppelte werden entfernt, Unbrauchbares wird gemeldet statt verschluckt.
- **TLD-Matrix** — einen Wunschnamen gegen viele Endungen auf einmal prüfen
  (`acme` × `de com eu io` → 4 Abfragen), mit Vorlagen für DACH, Global, EU, Tech und Shop.
- **Vollständige RDAP-Details** — Registrar, Registrierungs-, Änderungs- und Ablaufdatum,
  EPP-Status, Nameserver, DNSSEC und Registry-Handle, aufklappbar je Zeile.
- **Ehrliche Statusangaben** — jedes Ergebnis trägt eine Aussagekraft (verbindlich / Hinweis /
  keine Aussage). Was nicht sicher ist, wird nicht als „frei" verkauft.
- **Filter, Suche und Export** — nach Status filtern, nach Domain oder Registrar suchen,
  als CSV oder JSON herunterladen, freie Domains als Liste in die Zwischenablage.
- **Abbrechbar** — laufende Prüfungen lassen sich jederzeit stoppen.
- **Deutsch / Englisch**, Hell/Dunkel/System, Tastaturbedienung, `Strg`/`Cmd` + `Enter` zum Starten.
- **Zustand bleibt erhalten** — Eingaben, Sprache und Theme überleben einen Reload.

## Wie die Verfügbarkeit ermittelt wird

1. Beim Start wird die [IANA-Bootstrap-Registry](https://data.iana.org/rdap/dns.json) geladen
   (RFC 7484) und für 24 Stunden lokal zwischengespeichert.
2. Für jede Domain wird per **Longest-Suffix-Match** die zuständige Registry bestimmt —
   `acme.co.uk` trifft damit den `co.uk`-Eintrag und nicht den für `uk`.
3. Abfrage von `<registry>/domain/<name>` (RFC 9082) und Auswertung:

| Antwort                              | Status            | Aussagekraft  |
| ------------------------------------ | ----------------- | ------------- |
| `404`                                | Frei              | verbindlich   |
| `200` mit Domain-Objekt              | Vergeben          | verbindlich   |
| `200`, Status enthält `reserved`     | Reserviert        | verbindlich   |
| `200` ohne erkennbares Domain-Objekt | Vergeben          | nur Hinweis   |
| `400` / `422`                        | Ungültige Abfrage | keine Aussage |
| `403` / `451`                        | Abgelehnt         | keine Aussage |
| `429` (nach Retries)                 | Rate-Limit        | keine Aussage |
| `5xx`                                | Registry-Fehler   | keine Aussage |
| Netzwerk-/CORS-Fehler                | Nicht erreichbar  | keine Aussage |

Die Regel dahinter steht vollständig in [`src/core/classify.ts`](src/core/classify.ts) und lautet:
**bei Zweifel niemals „frei" behaupten.** Ein falsches „vergeben" kostet eine manuelle Nachprüfung,
ein falsches „frei" kostet eine Namensentscheidung.

### Sonderfall Subdomains

Ohne die vollständige Public Suffix List lässt sich `shop.acme.de` (Subdomain) nicht sicher von
`acme.co.uk` (registrierbar) unterscheiden. Hat eine Eingabe mehr Labels, als der gefundene
Registry-Suffix erlaubt, wird die Zeile als _möglicherweise Subdomain_ markiert und ein „frei"
auf **Hinweis** herabgestuft — statt es zu verschweigen oder die Zeile abzulehnen.

## Bekannte Grenzen

- **CORS.** Die großen gTLD-Registries (Verisign, PIR, Identity Digital …) senden
  `Access-Control-Allow-Origin: *`, wie es das ICANN RDAP Response Profile verlangt. Manche
  ccTLD-Registries tun das nicht — diese Domains erscheinen als _Nicht erreichbar_, die Antwort
  lässt sich aber über den JSON-Link je Zeile manuell prüfen. Ohne Backend ist das nicht lösbar,
  und ein Backend würde die Eingaben der Nutzer über einen fremden Server leiten.
- **Lücken in IANA's `dns.json`.** Manche Registries betreiben RDAP, sind dort aber nicht
  eingetragen. Siehe [Manuelle Ergänzungen](#manuelle-ergänzungen).
- **„Frei" ≠ „registrierbar".** Premium-, Sperr- und Markenschutzlisten sind über RDAP nicht
  sichtbar. Die endgültige Auskunft gibt der Registrar.
- **Maximal 500 Domains pro Lauf**, damit ein versehentlich eingefügtes Tabellenblatt keine
  Registry flutet.

## Manuelle Ergänzungen

`MANUAL_OVERRIDES` in [`src/core/bootstrap.ts`](src/core/bootstrap.ts) füllt Lücken in IANA's
Bootstrap-Datei. Einträge greifen **nur**, wenn IANA den Suffix nicht kennt — sobald er dort
auftaucht, gewinnt IANA automatisch.

| TLD   | RDAP-Server              | Quelle                                                                           |
| ----- | ------------------------ | -------------------------------------------------------------------------------- |
| `.de` | `https://rdap.denic.de/` | [DENIC RDAP-Service](https://www.denic.de/en/service/whois-service/rdap-service) |

**Vor dem Ergänzen weiterer TLDs — nicht raten:**

```bash
curl -sI -H 'Accept: application/rdap+json' \
  https://rdap.<registry>/domain/<bekannte-domain> | head -20
```

Der Dienst muss (a) unauthentifiziert antworten, (b) `Access-Control-Allow-Origin` senden und
(c) über HTTPS laufen. Registries mit ausschließlich authentifiziertem RDAP-Zugang (z. B. SWITCH
für `.ch`) passen nicht in dieses Modell. Nicht-HTTPS-URLs werden vom Code grundsätzlich verworfen.

## Sicherheit

Details in [SECURITY.md](SECURITY.md). Die Kurzfassung:

- **Strikte Content-Security-Policy** im Produktions-Build: `default-src 'none'`, kein Inline-Script,
  kein Inline-Style, dazu `require-trusted-types-for 'script'`.
- **Kein `innerHTML`** — das gesamte DOM wird über typisierte Helfer gebaut; eine ESLint-Regel
  blockt jede Zuweisung an `innerHTML`/`outerHTML`/`insertAdjacentHTML` projektweit.
- **URLs aus Fremddaten** werden zweifach geprüft (beim Einlesen der Bootstrap-Datei und beim
  Rendern) und nur mit `https:` akzeptiert.
- **Keine externen Ressourcen** — keine Webfonts, keine CDNs, keine Analytics. System-Font-Stack
  statt Google Fonts, damit keine Besucher-IP an Dritte fließt (DSGVO).
- **`referrer: no-referrer`** — die aufgerufene Seite taucht in keinem Registry-Log auf.
- **CSV-Export ist injection-sicher** — Zellen, die mit `= + - @` beginnen, werden neutralisiert,
  damit Registry-Daten in Excel keine Formeln werden (CWE-1236).
- **Keine Laufzeit-Abhängigkeiten.** Der ausgelieferte Code enthält ausschließlich eigenen Code.

## Entwicklung

Voraussetzung: Node ≥ 20.19 (siehe [`.nvmrc`](.nvmrc)).

```bash
npm ci
npm run dev          # Dev-Server auf http://localhost:5173
npm run verify       # format + lint + typecheck + test + build
```

Einzelne Schritte:

| Befehl                      | Zweck                           |
| --------------------------- | ------------------------------- |
| `npm run test`              | Vitest einmalig                 |
| `npm run test:watch`        | Vitest im Watch-Modus           |
| `npm run test:coverage`     | Coverage mit 80-%-Schwellwerten |
| `npm run lint` / `lint:fix` | ESLint (typbewusst)             |
| `npm run typecheck`         | `tsc --noEmit`                  |
| `npm run format`            | Prettier                        |
| `npm run build`             | Produktions-Build nach `dist/`  |
| `npm run preview`           | Build lokal ausliefern          |

### Aufbau

```text
src/
  core/                 komplett DOM-frei und damit direkt testbar
    types.ts            gemeinsames Domänenmodell
    domain.ts           Normalisierung, IDN→Punycode, Validierung, TLD-Matrix
    bootstrap.ts        IANA-Registry: laden, prüfen, cachen, Suffix-Match
    rdap.ts             HTTP-Client: Timeout, Retry, Backoff, Per-Origin-Limit
    rdap-response.ts    defensives Auslesen von RFC-9083-Antworten
    classify.ts         Verfügbarkeits-Policy (die fachliche Kernregel)
    checker.ts          Orchestrierung eines Laufs
    export.ts           CSV/JSON/Liste
    pool.ts             Nebenläufigkeit
    storage.ts          fehlertoleranter localStorage-Wrapper
  i18n/                 typsichere Übersetzungen DE/EN
  ui/                   DOM-Schicht (dom.ts kapselt alle unsicheren Operationen)
```

Die Trennung ist bewusst: `rdap.ts` beantwortet _wie_ gefragt wird, `classify.ts` beantwortet
_was die Antwort bedeutet_. Die eine ändert man aus Performance-Gründen, die andere aus fachlichen —
getrennt lassen sich beide unabhängig prüfen und ändern.

## CI/CD

Die Automatisierung nutzt die gemeinsamen Workflows aus
[`bauer-group/automation-templates`](https://github.com/bauer-group/automation-templates) statt
eigener Implementierungen.

| Workflow                                                         | Auslöser                                         | Was passiert                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`pr.yml`](.github/workflows/pr.yml)                             | Pull Request auf `main`                          | Ruft `nodejs-build.yml` auf: Format, Lint, Typecheck, Tests mit Coverage, Build, `npm audit`                                             |
| [`release.yml`](.github/workflows/release.yml)                   | Push auf `main`, manuell                         | Dieselbe Validierung, danach `modules-semantic-release.yml` — Version und `CHANGELOG.md` entstehen ab jetzt aus den Conventional Commits |
| [`deploy-pages.yml`](.github/workflows/deploy-pages.yml)         | Quellcode-Push, abgeschlossener Release, manuell | Prüft und baut, veröffentlicht `dist/` per OIDC nach GitHub Pages                                                                        |
| [`ai-issue-summary.yml`](.github/workflows/ai-issue-summary.yml) | Neues Issue oder PR                              | Ruft `modules-ai-issue-summary.yml` für die Triage-Zusammenfassung auf                                                                   |

Pages-Deployment ist bewusst selbst implementiert: Die gemeinsame Bibliothek enthält kein
Pages-Modul, und der Zwei-Job-Split Build → Deploy mit OIDC entspricht dem Muster der übrigen
Pages-Repositories.

Der Qualitäts-Gate läuft absichtlich auch in `deploy-pages.yml`. `release.yml` ignoriert
`.github/**`, eine reine Workflow-Änderung käme sonst ungeprüft auf Pages — und hier _ist_ die
veröffentlichte Seite das Produkt.

Einmalige Einrichtung: **Settings → Pages → Source: GitHub Actions**.

Der Base-Pfad wird automatisch bestimmt (`/<repo>/` für Projekt-Seiten, `/` für
`<owner>.github.io`), Forks funktionieren also ohne Anpassung.

> **Hinweis zur Sichtbarkeit:** GitHub Pages ist nach der Aktivierung öffentlich erreichbar, auch
> bei privatem Quell-Repository. Eine wirklich zugriffsbeschränkte Seite erfordert GitHub
> Enterprise Cloud mit Pages Access Control. Da das Tool ausschließlich öffentliche RDAP-Daten
> abfragt und keinerlei Eingaben an einen Server sendet, ist das in der Regel unkritisch.

## Lizenz

[MIT](LICENSE)
