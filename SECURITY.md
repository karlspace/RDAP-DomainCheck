# Sicherheit

## Schwachstelle melden

Sicherheitsprobleme bitte **nicht** über einen öffentlichen Issue melden, sondern über
[GitHub Security Advisories](https://github.com/karlspace/RDAP-DomainCheck/security/advisories/new).
Rückmeldung erfolgt in der Regel innerhalb von fünf Werktagen.

## Bedrohungsmodell

Die Anwendung ist eine rein statische Seite ohne Backend, Konten oder Sitzungen. Damit entfallen
ganze Angriffsklassen (SQL-Injection, Auth-Bypass, Serverseitige Rechteausweitung), und es bleiben
im Wesentlichen drei Angriffsflächen:

| #   | Angriffsfläche                    | Risiko                                            | Gegenmaßnahme                                                                                             |
| --- | --------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Antworten fremder RDAP-Registries | XSS über Registrar-Namen, Statuswerte, Nameserver | Kein `innerHTML`; Text ausschließlich über `textContent`; strikte CSP                                     |
| 2   | URLs aus IANA's Bootstrap-Datei   | `javascript:`/`data:`-URL landet in einem `href`  | Zweifache Prüfung: beim Einlesen (`normalizeRegistryUrl`) und beim Rendern (`safeHttpsUrl`), nur `https:` |
| 3   | Exportierte Dateien               | Formel-Injection in Excel/LibreOffice (CWE-1236)  | Zellen mit führendem `= + - @ \t \r` werden mit `'` neutralisiert                                         |

## Maßnahmen im Einzelnen

### Content-Security-Policy

Der Produktions-Build liefert:

```text
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self';
font-src 'self';
connect-src https:;
form-action 'none';
base-uri 'none';
frame-ancestors 'none';
require-trusted-types-for 'script'
```

`connect-src https:` ist so eng wie es hier geht: der Zweck des Werkzeugs ist die Abfrage
beliebiger, von IANA benannter RDAP-Endpunkte — diese Menge ist nicht vorab bekannt. Die
Einschränkung auf `https:` schließt dennoch Klartext-Verbindungen und alle Nicht-HTTP-Schemata aus.

`require-trusted-types-for 'script'` macht die Projektregel „niemals `innerHTML`" zu etwas, das der
Browser erzwingt, statt zu etwas, das wir nur beabsichtigen.

Zwei Build-Einstellungen halten die CSP durchsetzbar:

- `build.modulePreload.polyfill: false` — sonst injiziert Vite ein Inline-`<script>`.
- `build.assetsInlineLimit: 0` — sonst würden kleine Assets als `data:`-URI eingebettet.

Die CSP wird per `transformIndexHtml` **nur im Build** eingefügt, weil der Dev-Server Styles per
Inline-`<style>` ausliefert. Andernfalls müsste `'unsafe-inline'` dauerhaft erlaubt werden, nur
damit die Entwicklung funktioniert.

> **Grenze:** GitHub Pages kann keine HTTP-Header setzen. Die CSP kommt daher als `<meta>`-Tag,
> wodurch `frame-ancestors` wirkungslos bleibt (nur als Header gültig). Da die Seite weder
> Anmeldung noch zustandsverändernde Aktionen kennt, ist Clickjacking hier ohne Wirkung.

### Umgang mit Fremddaten

Sowohl IANA's Bootstrap-Datei als auch jede Registry-Antwort werden als nicht vertrauenswürdig
behandelt:

- Jede Ebene wird auf ihre Form geprüft; fehlerhafte Einträge werden übersprungen statt den
  gesamten Vorgang abzubrechen.
- Listenlängen sind gedeckelt (24 EPP-Status, 16 Nameserver, 200 Zeichen je Feld).
- Antwortkörper über 1 MiB werden gar nicht erst geparst.
- Der `Content-Type` wird geprüft, bevor JSON-Parsing versucht wird.

### Datenschutz

- **Keine externen Ressourcen.** Keine Webfonts, keine CDNs, kein Analytics. Der System-Font-Stack
  ersetzt die im Prototyp verwendete Google-Fonts-Einbindung, die die IP-Adresse jedes Besuchers
  ohne Einwilligung an Google übertragen hätte (LG München I, 3 O 17493/20).
- **`<meta name="referrer" content="no-referrer">`** — die abgefragten Registries erfahren nicht,
  von welcher Seite die Anfrage kommt.
- **`credentials: 'omit'`** bei jeder Anfrage — es werden keine Cookies mitgesendet.
- **Keine Übertragung an Dritte außer der jeweiligen Registry.** Eingegebene Domains verlassen den
  Browser ausschließlich als RDAP-Abfrage an die für die TLD zuständige Registry. Es gibt kein
  Backend, das die Eingaben sehen könnte.

  **Eine Ausnahme, opt-in:** Die abschaltbare DNS-Vorprüfung sendet den Domainnamen an Cloudflare
  DNS (1.1.1.1), um für browserblockierte Registries wenigstens „vergeben" feststellen zu können.
  Sie ist standardmäßig aus, der Schalter nennt den Empfänger im Klartext, und die Einstellung
  wird lokal gespeichert. Ausgeschaltet stellt das Werkzeug keine einzige Anfrage an Cloudflare.

- **Lokale Speicherung** beschränkt sich auf `localStorage` im Browser: letzte Eingabe, Sprache,
  Theme, der Registry-Cache und der Schalterzustand der DNS-Vorprüfung. Nichts davon verlässt das
  Gerät.

### Abhängigkeiten

Die ausgelieferte Anwendung hat **null Laufzeit-Abhängigkeiten** — im Bundle steht ausschließlich
Code aus diesem Repository. Alle npm-Pakete sind Entwicklungswerkzeuge und landen nie beim Nutzer.
Damit ist die Supply-Chain-Angriffsfläche zur Laufzeit gleich null.

Dependabot aktualisiert Werkzeuge und GitHub Actions wöchentlich; die CI muss vor jedem Merge
grün sein.

### Automatisch durchgesetzte Regeln

Diese Zusagen sind nicht bloß dokumentiert, sondern erzwungen:

| Regel                                                 | Durchsetzung                                            |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Kein `innerHTML` / `outerHTML` / `insertAdjacentHTML` | ESLint `no-restricted-syntax`, projektweit              |
| Kein `document.write`                                 | ESLint `no-restricted-properties`                       |
| Kein generisches Setzen von `href`/`src`/`on*`        | Laufzeitfehler in `el()`                                |
| Nur HTTPS-Registry-URLs                               | `normalizeRegistryUrl` + `safeHttpsUrl`, beide getestet |
| CSV ohne Formel-Injection                             | Test in `src/core/export.test.ts`                       |
| Vollständige Übersetzungen                            | Compile-Fehler durch `Record<TranslationKey, string>`   |
