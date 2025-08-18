// New method for har analysis old: harAnalyzer.js

const HarAnalyzer = require('./harAnalyzer');
const path = require('path');
const fs = require('fs');
const { program } = require('commander');

// Version aus package.json lesen (falls vorhanden)
let version = '1.0.0';
try {
  const packageJson = require('../package.json');
  if (packageJson.version) {
    version = packageJson.version;
  }
} catch (error) {
  // Ignorieren, wenn package.json nicht existiert
}

// Kommandozeilen-Interface konfigurieren
program
  .version(version)
  .description('HAR-Analyse-Tool für den Vergleich verschiedener Crawl-Clients')
  .option('-d, --crawl-dir <dir>', 'Verzeichnis mit HAR-Dateien (Crawl-Ordner)', path.join(__dirname, '../crawl_data'))
  .option('-o, --output-dir <dir>', 'Ausgabeverzeichnis für Berichte', path.join(__dirname, '../analysis_results'))
  .option('-f, --format <format>', 'Ausgabeformat (json, html, csv oder all)', 'all')
  .option('--disable-adblock', 'AdBlock-Analyse deaktivieren (standardmäßig aktiv)')
  .option('--disable-media', 'Medienanalyse deaktivieren (standardmäßig aktiv)')
  .option('--normalize-urls', 'URL-Query-Parameter normalisieren, um dynamische IDs zu entfernen')
  .option('-v, --verbose', 'Ausführliche Ausgabe')
  .option('--include-requests-in-json', 'Schließt detaillierte Request-Listen in die JSON-Ausgabe ein')
  .parse(process.argv);

const options = program.opts();

// Konfiguration
const config = {
  // Verzeichnis mit HAR-Dateien (Crawl-Ordner)
  crawlDirectory: options.crawlDir,
  
  // Ausgabeverzeichnis
  outputDirectory: options.outputDir,
  
  // Ausgabeformat
  outputFormat: options.format,
  
  // Analyzer-Optionen
  analyzerOptions: {
    adBlockEnabled: !options.disableAdblock,
    mediaAnalysisEnabled: !options.disableMedia,
    normalizeUrls: options.normalizeUrls,
    verbose: options.verbose, // Pass verbose option to analyzer
    includeRequestsInJson: options.includeRequestsInJson,
  },
  
  // Ausführliche Ausgabe
  verbose: options.verbose
};

// Ausgabeverzeichnis erstellen, falls es nicht existiert
if (!fs.existsSync(config.outputDirectory)) {
  fs.mkdirSync(config.outputDirectory, { recursive: true });
}

// Hilfsfunktion für ausführliche Ausgabe
function log(message) {
  if (config.verbose) {
    console.log(message);
  }
}

// Hauptfunktion
async function main() {
  console.log('HAR-Analyse wird gestartet...');
  console.log(`Crawl-Verzeichnis: ${config.crawlDirectory}`);
  
  // Prüfen, ob das Crawl-Verzeichnis existiert
  if (!fs.existsSync(config.crawlDirectory)) {
    console.error(`Fehler: Das Crawl-Verzeichnis "${config.crawlDirectory}" existiert nicht.`);
    process.exit(1);
  }
  
  // Analyzer initialisieren
  const analyzer = new HarAnalyzer(config.analyzerOptions);
  
  // Crawl-Verzeichnis analysieren
  console.log('Analysiere Crawl-Verzeichnis mit der Struktur: crawl_ordner/url_ordner/client_ordner/har_datei');
  const results = await analyzer.analyzeCrawlDirectory(config.crawlDirectory);
  
  log('Analyse abgeschlossen. Erstelle Client-Vergleich...');
  
  // Client-Vergleich erstellen
  let comparison;
  try {
    comparison = analyzer.compareClientResults(results);
  } catch (err) {
    console.error('Fehler beim Erstellen des Client-Vergleichs:', err);
    comparison = { error: String(err), timestamp: new Date().toISOString() };
  }
  
  // Ergebnisse exportieren
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  
  // Ausgabeformate bestimmen
  const formats = config.outputFormat.toLowerCase() === 'all' 
    ? ['json', 'html', 'csv'] 
    : [config.outputFormat.toLowerCase()];
  
  // Detaillierte Ergebnisse (werden nicht mehr separat gespeichert)
  // const detailedOutputPath = path.join(config.outputDirectory, `detailed_analysis_${timestamp}`);
  
  // Umfassender Report-Dateiname
  const reportPath = path.join(config.outputDirectory, `analysis_report_${timestamp}`);
  
  // CSV-Zusammenfassung
  const csvOutputPath = path.join(config.outputDirectory, `analysis_summary_${timestamp}.csv`);
  
  // Ergebnisse in den gewünschten Formaten exportieren
  for (const format of formats) {
    if (format === 'json') {
      analyzer.exportResults(comparison, `${reportPath}.json`, 'json');
      console.log(`JSON-Bericht wurde gespeichert in: ${reportPath}.json`);
    } else if (format === 'html') {
      if (!comparison.error) {
        analyzer.exportResults(comparison, `${reportPath}.html`, 'html');
      } else {
        // Falls Vergleich fehlgeschlagen ist, exportiere eine einfache Fehlerseite
        const errorHtml = `<html><body><h1>Client-Vergleich</h1><p>Fehler: ${comparison.error}</p><p>Zeit: ${comparison.timestamp}</p></body></html>`;
        fs.writeFileSync(`${reportPath}.html`, errorHtml);
      }
      console.log(`HTML-Bericht wurde gespeichert in: ${reportPath}.html`);
    } else if (format === 'csv') {
      if (!comparison.error) {
        analyzer.exportResults(comparison, csvOutputPath, 'csv');
      }
      console.log(`CSV-Zusammenfassung wurde gespeichert in:`);
      console.log(`- ${csvOutputPath}`);
    } else {
      console.warn(`Warnung: Unbekanntes Format "${format}" wird ignoriert.`);
    }
  }
  
  // Zusammenfassung ausgeben
  console.log('\nZusammenfassung:');
  console.log(`- Analysierte URLs: ${results.summary.totalUrls}`);
  console.log(`- Analysierte Clients: ${results.summary.totalClients}`);
  
  // Client-Statistiken ausgeben
  console.log('\nClient-Statistiken:');
  for (const [client, stats] of Object.entries(results.clients)) {
    console.log(`- ${client}:`);
    console.log(`  - Analysierte URLs: ${stats.urlsAnalyzed}`);
    console.log(`  - Gesamtanfragen: ${stats.totalRequests}`);
    console.log(`  - Gesamtfehler: ${stats.totalErrors}`);
    console.log(`  - Durchschnitt Anfragen/URL: ${stats.avgRequestsPerUrl.toFixed(2)}`);
  }
  
  console.log('\nAnalyse und Vergleich abgeschlossen.');
  console.log(`Ergebnisse wurden in ${config.outputDirectory} gespeichert.`);
}

// Skript ausführen
main().catch(error => {
  console.error('Fehler bei der Analyse:', error);
  process.exit(1);
});
