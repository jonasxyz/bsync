# HAR-Analyse-Tool

Dieses Tool analysiert HAR-Dateien (HTTP Archive), die von verschiedenen Crawl-Clients generiert wurden, und erstellt Berichte mit wichtigen Kennzahlen und Vergleichen zwischen den Clients.

## Funktionen

- Analyse von HAR-Dateien aus einer strukturierten Verzeichnisstruktur
- Extraktion wichtiger Kennzahlen wie:
  - Anzahl der HTTP-Requests und Responses
  - Anzahl der Errorcodes (4xx, 5xx)
  - Vergleich der Request-URLs zwischen Clients
- Generierung von Berichten in verschiedenen Formaten (JSON, HTML, CSV)
- Ansprechende visuelle Darstellung der Ergebnisse in HTML-Berichten

## Installation

1. Stelle sicher, dass Node.js (Version 14 oder höher) installiert ist
2. Klone dieses Repository
3. Installiere die Abhängigkeiten:

```bash
cd harAnalysis
npm install
```

**Wichtiger Hinweis**: Das Tool benötigt die `@ghostery/adblocker` Bibliothek für erweiterte AdBlock-Funktionen. Falls die Installation fehlschlägt, installieren Sie die Abhängigkeiten manuell:

```bash
npm install @ghostery/adblocker commander chart.js
```

4. (Optional) Teste die AdBlock-Erkennung (EasyPrivacy/EasyList):

```bash
npm test
```

## Verwendung

Das Tool kann über die Kommandozeile mit verschiedenen Optionen aufgerufen werden:

```bash
node Client/harAnalysis.js [Optionen]
```

### Optionen

- `-d, --crawl-dir <dir>`: Verzeichnis mit HAR-Dateien (Crawl-Ordner)
- `-o, --output-dir <dir>`: Ausgabeverzeichnis für Berichte
- `-f, --format <format>`: Ausgabeformat (json, html, csv oder all)
- `--no-adblock`: AdBlock-Analyse deaktivieren
- `--no-captcha`: CAPTCHA-Erkennung deaktivieren
- `--no-media`: Medienanalyse deaktivieren
- `-v, --verbose`: Ausführliche Ausgabe
- `-h, --help`: Hilfe anzeigen
- `-V, --version`: Version anzeigen

### Beispiele

Analyse eines Crawl-Verzeichnisses mit Standardoptionen:

```bash
node Client/harAnalysis.js -d /pfad/zum/crawl/verzeichnis
```

Analyse mit spezifischem Ausgabeverzeichnis und Format:

```bash
node Client/harAnalysis.js -d /pfad/zum/crawl/verzeichnis -o /pfad/zum/ausgabe/verzeichnis -f html
```

Analyse mit deaktivierter CAPTCHA-Erkennung und ausführlicher Ausgabe:

```bash
node Client/harAnalysis.js -d /pfad/zum/crawl/verzeichnis --no-captcha -v
```

## Verzeichnisstruktur

Das Tool erwartet die folgende Verzeichnisstruktur:

```
crawl_ordner/
├── url_ordner_1/
│   ├── client_ordner_1/
│   │   └── har_datei.har
│   └── client_ordner_2/
│       └── har_datei.har
└── url_ordner_2/
    ├── client_ordner_1/
    │   └── har_datei.har
    └── client_ordner_2/
        └── har_datei.har
```

- `crawl_ordner`: Hauptverzeichnis für einen Crawl
- `url_ordner`: Verzeichnis für eine bestimmte URL (benannt nach der URL)
- `client_ordner`: Verzeichnis für einen bestimmten Client
- `har_datei.har`: HAR-Datei für die URL und den Client

## Ausgabe

Das Tool generiert verschiedene Ausgabedateien im angegebenen Ausgabeverzeichnis:

- `detailed_analysis_[timestamp].json`: Detaillierte Analyseergebnisse im JSON-Format
- `detailed_analysis_[timestamp].html`: Detaillierter Bericht im HTML-Format
- `client_comparison_[timestamp].json`: Client-Vergleichsergebnisse im JSON-Format
- `client_comparison_[timestamp].html`: Client-Vergleichsbericht im HTML-Format
- `client_summary_[timestamp].csv`: Zusammenfassung der Client-Statistiken im CSV-Format

## Analysierte Kennzahlen

Das Tool extrahiert und vergleicht die folgenden Kennzahlen aus den HAR-Dateien:

### Grundlegende Kennzahlen
- **Anzahl der HTTP-Requests**: Gesamtzahl der Anfragen pro URL und Client
- **Anzahl der Responses nach Status-Code**: Verteilung der Antworten nach HTTP-Status-Code (2xx, 3xx, 4xx, 5xx)
- **Anzahl der Fehler**: Summe der 4xx- und 5xx-Fehler
- **Timing-Metriken**: Ladezeiten, Antwortzeiten, etc.

### Erweiterte Kennzahlen (optional)
- **Tracking-Analyse**: Vollständige EasyList-Unterstützung mit @ghostery/adblocker
  - Kosmetische Regeln (Element-Hiding)
  - Komplexe ABP-Optionen ($image, $third-party, $script, $domain=...)
  - Kategorisierung von Anfragen (Tracker, Werbung, etc.)
  - Detaillierte Analyse pro Request-Typ
- **Medienanalyse**: Anzahl und Größe von Bildern, Videos, etc.

### Vergleichsmetriken
- **Request-Differenz**: Unterschied in der Anzahl der Anfragen zwischen Clients
- **Fehler-Differenz**: Unterschied in der Anzahl der Fehler zwischen Clients
- **Einzigartige Request-URLs**: URLs, die nur von einem Client angefragt wurden

## Technische Details

Das Tool besteht aus den folgenden Hauptkomponenten:

- **harAnalysis.js**: Hauptskript mit Kommandozeilen-Interface
- **harAnalyzer.js**: Klasse zur Analyse von HAR-Dateien und Generierung von Berichten
- **adBlockLists.js**: Lädt EasyList (Ads) und EasyPrivacy (Tracking) via `@ghostery/adblocker`,
  cached die Engines und bietet Match-APIs (inkl. HAR-Unterstützung).

### Tracking-Zählung (EasyPrivacy vs. EasyList)

- Tracking-Anfragen basieren auf EasyPrivacy-Regeln und werden separat gezählt (`trackingRequests.total`).
- Werbe-Anfragen (EasyList) werden in `trackingRequests.adsTotal` geführt und nicht in `trackingRequests.total` eingerechnet.
  Details siehe `harAnalyzer._analyzeTrackingRequests()`.

## Troubleshooting

### Häufige Fehler

**1. `fs is not defined` Fehler:**
```
ReferenceError: fs is not defined
```
- **Lösung**: Stellen Sie sicher, dass alle Dateien die neuesten Versionen sind. Der `fs`-Import wurde in `adBlockLists.js` hinzugefügt.

**2. `getFiltersCount is not a function` Fehler:**
```
TypeError: this.engine.getFiltersCount is not a function
```
- **Lösung**: Die Ghostery AdBlock Engine API wurde angepasst. Verwenden Sie die neueste Version der Dateien.

**3. Netzwerkfehler beim Laden der Filterlisten:**
```
Failed to load AdBlock rules: Error: Request timeout
```
- **Lösung**: 
  - Überprüfen Sie Ihre Internetverbindung
  - Versuchen Sie es später erneut (Server könnte temporär nicht verfügbar sein)
  - Das Tool verwendet automatisch Cache-Dateien als Fallback

**4. Installation der @ghostery/adblocker fehlgeschlagen:**
- **Lösung**: Installieren Sie die Abhängigkeit manuell:
  ```bash
  npm install @ghostery/adblocker --save
  ```

### Debug-Modus

Verwenden Sie den `-v` (verbose) Flag für detaillierte Ausgaben:
```bash
node harAnalysis.js -d /pfad/zu/crawl/verzeichnis -v
```