# HAR-Analyse-Tool

Dieses Tool analysiert HAR-Dateien (HTTP Archive) aus synchronisierten Crawls und erstellt strukturierte Berichte inkl. kompakter Übersicht (compactSummary) und detaillierten Client-Vergleichen.

## Funktionen

- Analyse einer Crawl-Verzeichnisstruktur (url/Client/*.har)
- Extraktion zentraler Kennzahlen: Requests, Fehler (4xx/5xx), Statusgruppen, Media (Anzahl/Größe), Tracking (EasyPrivacy/EasyList)
- Synchronisationsanalyse: Start→erste Anfrage je Client, Spread pro URL, Overlap/Skew je Client-Paar
- Vergleich OpenWPM vs. nativer Firefox via frei konfigurierbarer Gruppierung
- Export in JSON, HTML, CSV, JSONL (kompakte Zeilen je URL/Client und optional je URL/Paar)
- Kompakte Zusammenfassung (`compactSummary`) direkt in der JSON-Ausgabe

## Installation

1. Node.js 16+ installieren
2. Abhängigkeiten installieren:

```bash
cd harAnalysis
npm install
```

Hinweis: Für Tracking-/Ads-Klassifikation wird `@ghostery/adblocker` verwendet.

## Verwendung

```bash
node harAnalysis/harAnalysis.js [Optionen]
```

### Wichtige Optionen

- `-d, --crawl-dir <dir>`: Crawl-Ordner (erwartete Struktur siehe unten)
- `-o, --output-dir <dir>`: Ausgabeverzeichnis
- `-f, --format <fmt>`: `json|html|csv|jsonl|all`
- `--disable-adblock`: Tracking-/Ads-Analyse deaktivieren
- `--disable-media`: Medienanalyse deaktivieren
- `--normalize-urls`: Query-Werte entfernen (reduziert Rauschen)
- `--include-requests-in-json`: Request-Listen in JSON belassen
- Kompakt-/Gruppierungs-Optionen:
  - `--compact-anonymize <none|domain|hash>`
  - `--compact-include-pairs`
  - `--compact-max-urls <n>`, `--compact-top-pairs <n>`
  - `--compact-top-pairs-by <abs_request_diff|ttfr_abs_diff>`
  - `--group-a-label <label>`, `--group-a-pattern <regex>`
  - `--group-b-label <label>`, `--group-b-pattern <regex>`
  - `--significant-top-n <n>`, `--significant-min-abs-request-diff <n>`
  - `--failed-urls-max-list <n>`
- `-v, --verbose`

### Beispiele

```bash
node harAnalysis/harAnalysis.js -d ./Crawl_2025-08-09_09-32-26 -o ./harAnalysis/analysis_results -f json
node harAnalysis/harAnalysis.js -d ./Crawl_... -o ./harAnalysis/analysis_results -f all --normalize-urls --compact-include-pairs
```

## Erwartete Verzeichnisstruktur

```
<crawl_dir>/
├─ 001_domain_com/
│  ├─ OpenWPM/
│  │  └─ *.har
│  └─ native_firefox/
│     └─ *.har
└─ 002_domain_com/
   └─ ...
```

## Ausgaben

- `analysis_report_<timestamp>.json` (enthält `overview`, `compactSummary`, `urlComparisons`, `clientSummary`, `overallSummary`)
- `analysis_report_<timestamp>.html` (interaktiver Vergleichsbericht)
- `analysis_summary_<timestamp>.csv` (tidy: eine Zeile je URL/Client)
- `analysis_report_<timestamp>.jsonl` (kompakte Zeilen; optional inkl. Paar-Diffs)

### compactSummary (Auszug)

```json
{
  "compactSummary": {
    "synchronization_delta_ms": { "n": 254, "median": 23, "max": 5070 },
    "intra_group": { "OpenWPM": { "requests": {"median": 0} }, "FirefoxNative": { ... } },
    "inter_group_abs_diff": { "requests": { "median": 1, "p95": 53.35 } },
    "outliers": [ { "url": "071_x_com", "metric": "requests", "diff": 119.5 } ]
  }
}
```

## Hinweise zur Tracking-/Ads-Klassifikation

- EasyPrivacy/EasyList via `@ghostery/adblocker`
- Konservative Schätzung: Ohne vollständigen Kontext (z.B. `$third-party`, `$domain`) kann Untererfassung auftreten

## Limitationen

- Dynamische Inhalte (WS, DOM) sind nur indirekt über HAR sichtbar
- Synchronisation ist sehr eng, aber nicht perfekt simultan (seltene Ausreißer möglich)
- Ergebnisse sind vergleichend zu interpretieren; keine absoluten Aussagen zur „Erkennung“ ohne tieferen Request-/Cookie-/Header-Vergleich

## Troubleshooting (Kurz)

- Installation schlägt fehl: `npm install @ghostery/adblocker commander chart.js`
- Keine HARs gefunden: Pfad/Struktur prüfen (`--crawl-dir`)
- Leere Tracking-Werte: `--disable-adblock` entfernen oder Internetzugang für Regeln sicherstellen