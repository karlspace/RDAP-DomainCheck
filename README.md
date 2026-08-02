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
| Netzwerkfehler / Timeout             | Nicht erreichbar  | keine Aussage |
| Registry ohne CORS (bekannt)         | Manuell prüfen    | keine Aussage |

Die Regel dahinter steht vollständig in [`src/core/classify.ts`](src/core/classify.ts) und lautet:
**bei Zweifel niemals „frei" behaupten.** Ein falsches „vergeben" kostet eine manuelle Nachprüfung,
ein falsches „frei" kostet eine Namensentscheidung.

### Sonderfall Subdomains

Ohne die vollständige Public Suffix List lässt sich `shop.acme.de` (Subdomain) nicht sicher von
`acme.co.uk` (registrierbar) unterscheiden. Hat eine Eingabe mehr Labels, als der gefundene
Registry-Suffix erlaubt, wird die Zeile als _möglicherweise Subdomain_ markiert und ein „frei"
auf **Hinweis** herabgestuft — statt es zu verschweigen oder die Zeile abzulehnen.

## Bekannte Grenzen

- **CORS — betrifft `.de`.** Ein Browser darf eine Antwort nur lesen, wenn die Registry
  `Access-Control-Allow-Origin` sendet. Alle geprüften gTLD-Registries tun das (ICANN RDAP
  Response Profile), ebenso `.fr`, `.nl`, `.uk` und `.dev`. **DENIC sendet den Header nicht** —
  weder bei `200` noch bei `404`. Die Antwort ist korrekt, nur für JavaScript unlesbar; per
  `curl` oder im Browser-Tab funktioniert dieselbe URL einwandfrei.

  Da JavaScript eine CORS-Ablehnung nicht von einem echten Netzwerkfehler unterscheiden kann,
  ist das in [`MANUAL_OVERRIDES`](src/core/bootstrap.ts) hinterlegt statt geraten. Solche
  Domains werden gar nicht erst abgefragt — das spart pro Domain einen kompletten
  Timeout-und-Retry-Zyklus — und erscheinen als _Manuell prüfen_ mit direktem Link auf die
  RDAP-Antwort. Teilweise auflösen lässt sich das mit der [DNS-Vorprüfung](#dns-vorprüfung).

- **Lücken in IANA's `dns.json`.** Manche Registries betreiben RDAP, sind dort aber nicht
  eingetragen. Siehe [Manuelle Ergänzungen](#manuelle-ergänzungen).
- **„Frei" ≠ „registrierbar".** Premium-, Sperr- und Markenschutzlisten sind über RDAP nicht
  sichtbar. Die endgültige Auskunft gibt der Registrar.
- **Maximal 500 Domains pro Lauf**, damit ein versehentlich eingefügtes Tabellenblatt keine
  Registry flutet.

## DNS-Vorprüfung

Optionaler Schalter unter dem Eingabefeld, **standardmäßig aus**. Er greift ausschließlich
für Registries, die den Browser blockieren, und nutzt eine Schlussfolgerung, die in genau eine
Richtung gilt:

> Die Domain hat NS-Records ⟹ sie ist delegiert ⟹ sie ist registriert.

Delegation existiert nur für registrierte Namen, diese Richtung kann also nicht falsch sein. Die
Umkehrung gilt **nicht**: Frisch registrierte, geparkte oder defensiv gehaltene Domains ohne
Nameserver sehen im DNS aus wie freie. Deshalb kennt [`src/core/dns.ts`](src/core/dns.ts) keinen
Rückgabewert `not-delegated` — NXDOMAIN, Timeout und Schrottantwort werden alle zu `unknown`. Die
unsichere Schlussfolgerung ist damit nicht bloß unerwünscht, sondern gar nicht ausdrückbar.

Praktisch heißt das: `.de`-Domains mit Nameservern werden sicher als _Vergeben_ erkannt und
verschwinden aus der Liste; der Rest bleibt _Manuell prüfen_. Beim Namens-Brainstorming schrumpft
die Klickliste damit erheblich, ohne dass je ein falsches „frei" entstehen kann.

**Preis:** Die Abfrage geht an Cloudflare DNS (1.1.1.1) statt nur an die Registry. Das ist der
einzige Punkt, an dem das Werkzeug einen Dritten kontaktiert — deshalb Opt-in, deshalb der
Klartext-Hinweis am Schalter.

## Manuelle Ergänzungen

`MANUAL_OVERRIDES` in [`src/core/bootstrap.ts`](src/core/bootstrap.ts) füllt Lücken in IANA's
Bootstrap-Datei. Einträge greifen **nur**, wenn IANA den Suffix nicht kennt — sobald er dort
auftaucht, gewinnt IANA automatisch.

| TLD   | RDAP-Server              | Im Browser nutzbar | Quelle                                                                           |
| ----- | ------------------------ | ------------------ | -------------------------------------------------------------------------------- |
| `.de` | `https://rdap.denic.de/` | nein — kein CORS   | [DENIC RDAP-Service](https://www.denic.de/en/service/whois-service/rdap-service) |

**Vor dem Ergänzen weiterer TLDs — nicht raten:**

```bash
curl -sD - -o /dev/null \
  -H 'Origin: https://example.org' \
  -H 'Accept: application/rdap+json' \
  https://rdap.<registry>/domain/<bekannte-domain> | grep -i access-control
```

Der Dienst muss (a) unauthentifiziert antworten und (b) über HTTPS laufen; Nicht-HTTPS-URLs
verwirft der Code grundsätzlich. Kommt (c) **kein** `Access-Control-Allow-Origin` zurück, gehört
`browserBlocked: true` an den Eintrag — der Test oben ist genau der, mit dem `.de` aufgefallen
ist. Registries mit ausschließlich authentifiziertem RDAP-Zugang (z. B. SWITCH für `.ch`) passen
gar nicht in dieses Modell.

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
| [`pr.yml`](.github/workflows/pr.yml)                             | Pull Request auf `main`                          | Format, Lint, Typecheck, Tests mit Coverage, Build, `npm audit` — bewusst inline, siehe unten                                            |
| [`release.yml`](.github/workflows/release.yml)                   | Push auf `main`, manuell                         | Dieselbe Validierung, danach `modules-semantic-release.yml` — Version und `CHANGELOG.md` entstehen ab jetzt aus den Conventional Commits |
| [`deploy-pages.yml`](.github/workflows/deploy-pages.yml)         | Quellcode-Push, abgeschlossener Release, manuell | Prüft und baut, veröffentlicht `dist/` per OIDC nach GitHub Pages                                                                        |
| [`ai-issue-summary.yml`](.github/workflows/ai-issue-summary.yml) | Neues Issue oder PR                              | Ruft `modules-ai-issue-summary.yml` für die Triage-Zusammenfassung auf                                                                   |

Zwei Workflows sind bewusst selbst implementiert:

- **Pages-Deployment** — die gemeinsame Bibliothek enthält kein Pages-Modul, und der
  Zwei-Job-Split Build → Deploy mit OIDC entspricht dem Muster der übrigen Pages-Repositories.
- **PR-Validierung** — `nodejs-build.yml` enthält einen Code-Quality-Job und verlangt vom
  Aufrufer daher `pull-requests: write`. GitHub prüft die Berechtigungen jeder aufgerufenen
  Workflow beim Anlegen des Runs, noch bevor `if:`-Bedingungen ausgewertet werden — die
  Anforderung gilt also auch bei abgeschaltetem Job. Bei Dependabot-Runs ist der `GITHUB_TOKEN`
  read-only, diese Grenze lässt sich nicht anheben, und jeder Dependabot-PR endete in
  `startup_failure`. Aus demselben Grund validieren auch die Schwester-Repositories ihre Pull
  Requests inline.

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
