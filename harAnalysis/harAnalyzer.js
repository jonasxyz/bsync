const fs = require('fs');
const path = require('path');
const AdBlockLists = require('./adBlockLists.js');

/**
 * HAR-Datei-Analyzer für den Vergleich verschiedener Crawl-Clients
 */
class HarAnalyzer {
  constructor(options = {}) {
    this.options = {
      adBlockEnabled: false,
      mediaAnalysisEnabled: false,
      normalizeUrls: false,
      verbose: false, // Default verbose to false
      includeRequestsInJson: false, // Default to false
      ...options
    };
    
    // AdBlock-Listen laden, falls aktiviert
    if (this.options.adBlockEnabled) {
      this.adBlockList = new AdBlockLists({ verbose: this.options.verbose });
      this.adBlockListInitialized = this.adBlockList.initialized;
    }
  }

  /**
   * Analysiert eine einzelne HAR-Datei und extrahiert Kennzahlen
   * @param {string} harFilePath - Pfad zur HAR-Datei
   * @returns {Object} Extrahierte Kennzahlen
   */
  async analyzeHarFile(harFilePath) {
    if (this.adBlockListInitialized) {
      await this.adBlockListInitialized; // Ensure legacy rules are loaded
    }
    try {
      const harContent = fs.readFileSync(harFilePath, 'utf8');
      const harData = JSON.parse(harContent);
      
      // Grundlegende Metriken
      const metrics = {
        fileName: path.basename(harFilePath),
        url: this._extractMainUrl(harData),
        totalRequests: harData.log.entries.length,
        responsesByCode: this._countResponsesByStatusCode(harData),
        totalErrors: 0,
        timing: this._calculateTimingMetrics(harData),
        sync: this._extractSyncMetrics(harData),
        requestUrls: this._extractRequestUrls(harData), // Original URLs
        normalizedRequestUrls: [], // Normalized URLs
        normalizationStats: {
          totalUrls: 0,
          normalizedUrls: 0,
        }
      };
      
      // URL-Normalisierung, falls aktiviert
      if (this.options.normalizeUrls) {
        metrics.normalizedRequestUrls = metrics.requestUrls.map(url => this._normalizeUrl(url));
        const uniqueOriginalUrls = new Set(metrics.requestUrls).size;
        const uniqueNormalizedUrls = new Set(metrics.normalizedRequestUrls).size;
        
        metrics.normalizationStats = {
          totalUrls: metrics.requestUrls.length,
          normalizedUrls: uniqueNormalizedUrls,
          originalUniqueUrls: uniqueOriginalUrls,
          reduction: uniqueOriginalUrls - uniqueNormalizedUrls,
          reductionPercentage: uniqueOriginalUrls > 0 ? ((uniqueOriginalUrls - uniqueNormalizedUrls) / uniqueOriginalUrls) * 100 : 0
        };
      }
      
      // Fehler zählen (4xx und 5xx)
      metrics.totalErrors = this._countErrors(metrics.responsesByCode);
      
      // Erweiterte Metriken, falls aktiviert
      if (this.options.adBlockEnabled) {
        metrics.trackingRequests = this._analyzeTrackingRequests(harData);
      }
      
      if (this.options.mediaAnalysisEnabled) {
        metrics.mediaFiles = this._analyzeMediaFiles(harData);
      }
      
      return metrics;
    } catch (error) {
      console.error(`Fehler beim Analysieren von ${harFilePath}:`, error);
      return {
        fileName: path.basename(harFilePath),
        error: error.message
      };
    }
  }

  /**
   * Analysiert einen Crawl-Ordner mit der Struktur:
   * crawl_ordner/url_ordner/client_ordner/har_datei
   * @param {string} crawlDirPath - Pfad zum Crawl-Verzeichnis
   * @returns {Object} Analyseergebnisse strukturiert nach URLs und Clients
   */
  async analyzeCrawlDirectory(crawlDirPath) {
    const results = {
      timestamp: new Date().toISOString(),
      urls: {},
      clients: {},
      summary: {
        totalUrls: 0,
        totalClients: 0,
        clientComparison: {},
        statusCodeDistribution: {}
      }
    };
    
    try {
      // Prüfen, ob das Verzeichnis existiert
      if (!fs.existsSync(crawlDirPath)) {
        console.error(`Verzeichnis existiert nicht: ${crawlDirPath}`);
        return results;
      }
      
      // Alle URL-Ordner im Crawl-Verzeichnis durchlaufen
      const urlDirs = fs.readdirSync(crawlDirPath)
        .filter(item => {
          const itemPath = path.join(crawlDirPath, item);
          return fs.statSync(itemPath).isDirectory();
        });
      
      // Liste aller gefundenen Clients
      const allClients = new Set();
      
      // Für jede URL
      for (const urlDir of urlDirs) {
        const urlPath = path.join(crawlDirPath, urlDir);
        results.urls[urlDir] = { clients: {} };
        
        // Alle Client-Ordner für diese URL durchlaufen
        let clientDirs = [];
        try {
          clientDirs = fs.readdirSync(urlPath)
            .filter(item => {
              const itemPath = path.join(urlPath, item);
              return fs.statSync(itemPath).isDirectory();
            });
        } catch (error) {
          console.error(`Fehler beim Lesen des URL-Verzeichnisses ${urlPath}:`, error);
          continue; // Mit der nächsten URL fortfahren
        }
        
        // Für jeden Client
        for (const clientDir of clientDirs) {
          allClients.add(clientDir);
          const clientPath = path.join(urlPath, clientDir);
          
          // HAR-Dateien im Client-Ordner suchen
          let harFiles = [];
          try {
            harFiles = fs.readdirSync(clientPath)
              .filter(file => path.extname(file).toLowerCase() === '.har');
          } catch (error) {
            console.error(`Fehler beim Lesen des Client-Verzeichnisses ${clientPath}:`, error);
            continue; // Mit dem nächsten Client fortfahren
          }
          
          if (harFiles.length > 0) {
            // Wir nehmen die erste HAR-Datei (normalerweise sollte nur eine pro URL/Client sein)
            const harFilePath = path.join(clientPath, harFiles[0]);
            const metrics = await this.analyzeHarFile(harFilePath);
            
            // Metriken für diese URL und diesen Client speichern
            results.urls[urlDir].clients[clientDir] = metrics;
            
            // Client-Statistiken initialisieren, falls noch nicht vorhanden
            if (!results.clients[clientDir]) {
              results.clients[clientDir] = {
                totalRequests: 0,
                totalErrors: 0,
                urlsAnalyzed: 0,
                statusCodes: {},
                trackingStats: { total: 0, adsTotal: 0 },
                mediaStats: { total: 0, size: 0 }
              };
            }
            
            // Client-Statistiken aktualisieren
            if (!metrics.error) {
              results.clients[clientDir].totalRequests += metrics.totalRequests || 0;
              results.clients[clientDir].totalErrors += metrics.totalErrors || 0;
              results.clients[clientDir].urlsAnalyzed++;

              // Tracking- und Media-Statistiken aggregieren
              if (metrics.trackingRequests) {
                results.clients[clientDir].trackingStats.total += metrics.trackingRequests.total || 0;
                results.clients[clientDir].trackingStats.adsTotal =
                  (results.clients[clientDir].trackingStats.adsTotal || 0) + (metrics.trackingRequests.adsTotal || 0);
              }
              if (metrics.mediaFiles) {
                results.clients[clientDir].mediaStats.total += metrics.mediaFiles.total || 0;
                results.clients[clientDir].mediaStats.size += metrics.mediaFiles.size || 0;
              }
              
              // Status-Codes zusammenfassen
              if (metrics.responsesByCode) {
                for (const [code, count] of Object.entries(metrics.responsesByCode)) {
                  results.clients[clientDir].statusCodes[code] = 
                    (results.clients[clientDir].statusCodes[code] || 0) + count;
                }
              }
            }
          }
        }
      }
      
      // Durchschnittswerte für jeden Client berechnen
      for (const client of allClients) {
        const clientStats = results.clients[client];
        if (clientStats && clientStats.urlsAnalyzed > 0) {
          clientStats.avgRequestsPerUrl = clientStats.totalRequests / clientStats.urlsAnalyzed;
          clientStats.avgErrorsPerUrl = clientStats.totalErrors / clientStats.urlsAnalyzed;
          
          // Durchschnittswerte für Tracking und Media
          if (clientStats.trackingStats) {
            clientStats.avgTrackingRequestsPerUrl = clientStats.trackingStats.total / clientStats.urlsAnalyzed;
            clientStats.avgAdsRequestsPerUrl = (clientStats.trackingStats.adsTotal || 0) / clientStats.urlsAnalyzed;
          }
          if (clientStats.mediaStats) {
            clientStats.avgMediaFilesPerUrl = clientStats.mediaStats.total / clientStats.urlsAnalyzed;
            clientStats.avgMediaSizePerUrl = clientStats.mediaStats.size / clientStats.urlsAnalyzed;
          }
        }
      }
      
      // Gesamtzusammenfassung berechnen
      results.summary = this._calculateOverallSummary(results);
      
      return results;
    } catch (error) {
      console.error(`Fehler beim Analysieren des Crawl-Verzeichnisses ${crawlDirPath}:`, error);
      return results; // Leere Ergebnisse zurückgeben
    }
  }

  /**
   * Vergleicht die Ergebnisse verschiedener Clients für jede URL
   * @param {Object} results - Ergebnisse der analyzeCrawlDirectory-Methode
   * @returns {Object} Vergleichsergebnisse
   */
  compareClientResults(results) {
    // Sicherstellen, dass die Eingabedaten gültig sind
    if (!results || !results.urls || !results.clients) {
      return {
        timestamp: new Date().toISOString(),
        urlComparisons: {},
        clientSummary: {},
        overallSummary: {
          totalUrls: 0,
          totalClients: 0,
          crawlDurationMinutes: 0
        }
      };
    }
    
    const comparison = {
      timestamp: new Date().toISOString(),
      urlComparisons: {},
      clientSummary: results.clients || {},
      overallSummary: results.summary || {
        totalUrls: 0,
        totalClients: 0,
        crawlDurationMinutes: 0
      },
      normalizationEnabled: this.options.normalizeUrls,
      syncStats: { perPair: {}, overall: {} },
      timingSpreads: { perUrl: {}, perPair: {}, perClient: {}, overall: {} },
      errorSummary: { byClient: {}, failedUrls: [] }
    };
    
    // Normalisierungsstatistiken aggregieren
    if (this.options.normalizeUrls) {
      comparison.normalizationSummary = {
        totalUrlsAcrossClients: 0,
        totalOriginalUniqueUrls: 0,
        totalNormalizedUniqueUrls: 0,
        clients: {}
      };

      for (const urlData of Object.values(results.urls)) {
        for (const [client, metrics] of Object.entries(urlData.clients)) {
          if (metrics.normalizationStats) {
            if (!comparison.normalizationSummary.clients[client]) {
              comparison.normalizationSummary.clients[client] = {
                totalUrls: 0,
                originalUniqueUrls: 0,
                normalizedUrls: 0,
              };
            }
            const clientSummary = comparison.normalizationSummary.clients[client];
            clientSummary.totalUrls += metrics.normalizationStats.totalUrls;
            clientSummary.originalUniqueUrls += metrics.normalizationStats.originalUniqueUrls;
            clientSummary.normalizedUrls += metrics.normalizationStats.normalizedUrls;
          }
        }
      }

      // Gesamtreduktion berechnen
      for(const clientStats of Object.values(comparison.normalizationSummary.clients)) {
        comparison.normalizationSummary.totalUrlsAcrossClients += clientStats.totalUrls;
        comparison.normalizationSummary.totalOriginalUniqueUrls += clientStats.originalUniqueUrls;
        comparison.normalizationSummary.totalNormalizedUniqueUrls += clientStats.normalizedUrls;
      }
    }
    
    // Für jede URL einen Vergleich der Client-Ergebnisse erstellen
    // Sammelbehälter für per-Client-Werte über alle URLs
    const timingValuesPerClient = {};
    // Sammelbehälter für per-URL Spreads (Start→erste Anfrage)
    const spreadsAll = [];
    let minCrawlStartTime = Infinity;
    let maxCrawlEndTime = 0;
    const urlsWithErrorsByClient = {};

    for (const [url, urlData] of Object.entries(results.urls || {})) {
      if (!urlData || !urlData.clients) continue; // Überspringen, wenn keine gültigen Daten
      
      comparison.urlComparisons[url] = {
        clients: urlData.clients, // Die Rohdaten für jeden Client hinzufügen
        requestDifferences: {},
        errorDifferences: {},
        statusCodeDifferences: {},
        uniqueRequestUrls: {},
        trackingDifferences: {},
        mediaDifferences: {},
        syncDifferences: { startSkewMs: {}, windowOverlap: {} }
      };
      
      const clients = Object.keys(urlData.clients || {});

      // Per-Client TTFR/Dauer sammeln und Crawl-Dauer ermitteln
      for (const [client, metrics] of Object.entries(urlData.clients || {})) {
        if (metrics.totalRequests === 0) {
            comparison.errorSummary.failedUrls.push({ url, client });
        }
        if (metrics.totalErrors > 0) {
            if (!urlsWithErrorsByClient[client]) {
                urlsWithErrorsByClient[client] = new Set();
            }
            urlsWithErrorsByClient[client].add(url);
        }

        const s = metrics && metrics.sync ? metrics.sync : null;
        if (!s) continue;

        if (s.visitStartMs && s.visitStartMs < minCrawlStartTime) {
            minCrawlStartTime = s.visitStartMs;
        }
        if (s.lastRequestEndMs && s.lastRequestEndMs > maxCrawlEndTime) {
            maxCrawlEndTime = s.lastRequestEndMs;
        }

        if (!timingValuesPerClient[client]) timingValuesPerClient[client] = { ttfr: [], duration: [] };
        if (typeof s.firstRequestOffsetMs === 'number' && !isNaN(s.firstRequestOffsetMs)) {
          timingValuesPerClient[client].ttfr.push(s.firstRequestOffsetMs);
        }
        if (typeof s.durationMs === 'number' && !isNaN(s.durationMs)) {
          timingValuesPerClient[client].duration.push(s.durationMs);
        }
      }

      // Per-URL: Spread der Start→erste Anfrage (max-min über Clients)
      const offsets = [];
      const byClient = {};
      for (const client of clients) {
        const val = urlData.clients[client]?.sync?.firstRequestOffsetMs;
        if (typeof val === 'number' && !isNaN(val)) {
          offsets.push(val);
          byClient[client] = val;
        }
      }
      if (offsets.length >= 2) {
        const maxv = Math.max(...offsets);
        const minv = Math.min(...offsets);
        const spread = maxv - minv;
        spreadsAll.push(spread);
        comparison.timingSpreads.perUrl[url] = { spreadMs: spread, valuesByClient: byClient };
      } else {
        comparison.timingSpreads.perUrl[url] = { spreadMs: 0, valuesByClient: byClient };
      }
      
      // Vergleich der Anfragenzahlen
      if (clients.length > 1) {
        for (let i = 0; i < clients.length; i++) {
          for (let j = i + 1; j < clients.length; j++) {
            const client1 = clients[i];
            const client2 = clients[j];
            const metrics1 = urlData.clients[client1];
            const metrics2 = urlData.clients[client2];
            
            if (!metrics1 || !metrics2 || metrics1.error || metrics2.error) continue;
            
            const comparisonKey = `${client1}_vs_${client2}`;

            // Anfragendifferenz
            const requestDiff = (metrics1.totalRequests || 0) - (metrics2.totalRequests || 0);
            comparison.urlComparisons[url].requestDifferences[comparisonKey] = requestDiff;
            
            // Fehlerdifferenz
            const errorDiff = (metrics1.totalErrors || 0) - (metrics2.totalErrors || 0);
            comparison.urlComparisons[url].errorDifferences[comparisonKey] = errorDiff;

            // Tracking-Differenz
            if (metrics1.trackingRequests && metrics2.trackingRequests) {
              comparison.urlComparisons[url].trackingDifferences[comparisonKey] = 
                (metrics1.trackingRequests.total || 0) - (metrics2.trackingRequests.total || 0);
              // Ads-Differenz (EasyList)
              const adsDiff = (metrics1.trackingRequests.adsTotal || 0) - (metrics2.trackingRequests.adsTotal || 0);
              if (!comparison.urlComparisons[url].adsDifferences) {
                comparison.urlComparisons[url].adsDifferences = {};
              }
              comparison.urlComparisons[url].adsDifferences[comparisonKey] = adsDiff;
            }
            
            // Medien-Differenz
            if (metrics1.mediaFiles && metrics2.mediaFiles) {
              comparison.urlComparisons[url].mediaDifferences[comparisonKey] = {
                total: (metrics1.mediaFiles.total || 0) - (metrics2.mediaFiles.total || 0),
                size: (metrics1.mediaFiles.size || 0) - (metrics2.mediaFiles.size || 0)
              };
            }

            // Vergleich der Status-Codes
            const statusCodeDiff = {};
            const allStatusCodes = new Set([
              ...Object.keys(metrics1.responsesByCode || {}),
              ...Object.keys(metrics2.responsesByCode || {})
            ]);
            
            for (const code of allStatusCodes) {
              const count1 = (metrics1.responsesByCode || {})[code] || 0;
              const count2 = (metrics2.responsesByCode || {})[code] || 0;
              if (count1 !== count2) {
                statusCodeDiff[code] = count1 - count2;
              }
            }
            
            comparison.urlComparisons[url].statusCodeDifferences[comparisonKey] = statusCodeDiff;
            
            // Vergleich der Request-URLs
            const urls1 = this.options.normalizeUrls ? metrics1.normalizedRequestUrls : metrics1.requestUrls;
            const urls2 = this.options.normalizeUrls ? metrics2.normalizedRequestUrls : metrics2.requestUrls;

            if (urls1 && urls2) {
              const uniqueToClient1 = urls1.filter(url => !urls2.includes(url));
              const uniqueToClient2 = urls2.filter(url => !urls1.includes(url));
              
              comparison.urlComparisons[url].uniqueRequestUrls[`unique_to_${client1}`] = uniqueToClient1;
              comparison.urlComparisons[url].uniqueRequestUrls[`unique_to_${client2}`] = uniqueToClient2;
            }

            // Synchronisationsvergleich: Start-Skew & Fenster-Overlap
            if (metrics1.sync && metrics2.sync) {
              const startSkewMs = (metrics1.sync.absoluteStartMs ?? metrics1.sync.firstRequestStartMs ?? 0) - (metrics2.sync.absoluteStartMs ?? metrics2.sync.firstRequestStartMs ?? 0);
              const first1 = (metrics1.sync.absoluteStartMs ?? metrics1.sync.firstRequestStartMs) ?? 0;
              const last1 = (metrics1.sync.absoluteEndMs ?? metrics1.sync.lastRequestEndMs) ?? first1;
              const first2 = (metrics2.sync.absoluteStartMs ?? metrics2.sync.firstRequestStartMs) ?? 0;
              const last2 = (metrics2.sync.absoluteEndMs ?? metrics2.sync.lastRequestEndMs) ?? first2;
              const overlapMs = Math.max(0, Math.min(last1, last2) - Math.max(first1, first2));
              const unionMs = Math.max(last1, last2) - Math.min(first1, first2) || 1;
              const overlapRatio = overlapMs / unionMs;

              comparison.urlComparisons[url].syncDifferences.startSkewMs[comparisonKey] = startSkewMs;
              comparison.urlComparisons[url].syncDifferences.windowOverlap[comparisonKey] = {
                overlapMs,
                unionMs,
                overlapRatio
              };

              // Aggregierte per-pair Stats vorbereiten
              if (!comparison.syncStats.perPair[comparisonKey]) {
                comparison.syncStats.perPair[comparisonKey] = { startSkews: [], overlapRatios: [] };
              }
              comparison.syncStats.perPair[comparisonKey].startSkews.push(Math.abs(startSkewMs));
              comparison.syncStats.perPair[comparisonKey].overlapRatios.push(overlapRatio);
            }

            // Timingvergleich relativ zum Visit (TTFR und Dauer)
            if (metrics1.sync && metrics2.sync) {
              const ttfr1 = metrics1.sync.firstRequestOffsetMs ?? 0;
              const ttfr2 = metrics2.sync.firstRequestOffsetMs ?? 0;
              const ttfrDiff = ttfr1 - ttfr2;

              if (!comparison.urlComparisons[url].timingDifferences) {
                comparison.urlComparisons[url].timingDifferences = { ttfrMs: {} };
              }
              comparison.urlComparisons[url].timingDifferences.ttfrMs[comparisonKey] = ttfrDiff;

              if (!comparison.timingSpreads.perPair[comparisonKey]) {
                comparison.timingSpreads.perPair[comparisonKey] = { ttfrAbsDiffs: [] };
              }
              comparison.timingSpreads.perPair[comparisonKey].ttfrAbsDiffs.push(Math.abs(ttfrDiff));
            }
          }
        }
      }
    }
    
    // Aggregation der Synchronisationsstatistiken
    const aggregate = (arr) => {
      if (!arr.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
      const sorted = [...arr].sort((a,b)=>a-b);
      const mean = sorted.reduce((a,b)=>a+b,0) / sorted.length;
      const p = (q) => sorted[Math.min(sorted.length-1, Math.floor(q * (sorted.length-1)))];
      return { mean, p50: p(0.5), p95: p(0.95), max: sorted[sorted.length-1] };
    };
    const computeStats = (arr) => {
      if (!arr || arr.length === 0) return { mean: 0, max: 0, stddev: 0 };
      const n = arr.length;
      const mean = arr.reduce((a,b)=>a+b,0) / n;
      const max = Math.max(...arr);
      const variance = arr.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
      const stddev = Math.sqrt(variance);
      return { mean, max, stddev };
    };
    for (const [pair, vals] of Object.entries(comparison.syncStats.perPair)) {
      comparison.syncStats.perPair[pair] = {
        startSkews: aggregate(vals.startSkews),
        overlapRatios: aggregate(vals.overlapRatios)
      };
    }
    // Overall über alle Paare
    const allSkews = [];
    const allOverlaps = [];
    for (const vals of Object.values(comparison.syncStats.perPair)) {
      allSkews.push(vals.startSkews.p50);
      allOverlaps.push(vals.overlapRatios.p50);
    }
    comparison.syncStats.overall = {
      startSkews: aggregate(allSkews),
      overlapRatios: aggregate(allOverlaps)
    };

    // Aggregation der Timingstatistiken (nur Mittelwert, Max, StdAbw)
    for (const [pair, vals] of Object.entries(comparison.timingSpreads.perPair)) {
      comparison.timingSpreads.perPair[pair] = {
        ttfrAbsDiffs: computeStats(vals.ttfrAbsDiffs)
      };
    }
    // Per-Client-Stats
    const overallTtfr = [];
    for (const [client, lists] of Object.entries(timingValuesPerClient)) {
      const ttfrStats = computeStats(lists.ttfr);
      comparison.timingSpreads.perClient[client] = {
        ttfr: ttfrStats
      };
      if (lists.ttfr && lists.ttfr.length) overallTtfr.push(...lists.ttfr);
    }
    // Overall-Stats für Spreads (über alle URLs)
    comparison.timingSpreads.overall = computeStats(spreadsAll);

    // Fehlerzusammenfassung erstellen
    for (const clientName in results.clients) {
        comparison.errorSummary.byClient[clientName] = {
            totalErrors: results.clients[clientName].totalErrors || 0,
            urlsWithErrors: urlsWithErrorsByClient[clientName] ? urlsWithErrorsByClient[clientName].size : 0,
        };
    }

    // Crawl-Dauer berechnen
    if (isFinite(minCrawlStartTime) && maxCrawlEndTime > 0) {
        comparison.overallSummary.crawlDurationMinutes = (maxCrawlEndTime - minCrawlStartTime) / (1000 * 60);
    }

    return comparison;
  }

  /**
   * Exportiert die Analyseergebnisse in verschiedene Formate
   * @param {Object} results - Analyseergebnisse
   * @param {string} outputPath - Pfad für die Ausgabedatei
   * @param {string} format - Ausgabeformat (json, csv, html)
   */
  exportResults(results, outputPath, format = 'json') {
    try {
      switch (format.toLowerCase()) {
        case 'json':
          let dataToWrite = results;
          // Wenn Request-Listen ausgeschlossen werden sollen, Daten klonen und Listen entfernen
          if (!this.options.includeRequestsInJson) {
            dataToWrite = JSON.parse(JSON.stringify(results)); // Tiefe Kopie
            // Detaillierter Bericht: Request-Listen aus jeder URL/Client-Kombi entfernen
            if (dataToWrite.urls) {
              for (const urlData of Object.values(dataToWrite.urls)) {
                for (const clientMetrics of Object.values(urlData.clients)) {
                  delete clientMetrics.requestUrls;
                  delete clientMetrics.normalizedRequestUrls;
                }
              }
            }
            // Vergleichsbericht: uniqueRequestUrls und tief genestete Request-Listen entfernen
            if (dataToWrite.urlComparisons) {
              for (const comparisonData of Object.values(dataToWrite.urlComparisons)) {
                delete comparisonData.uniqueRequestUrls;
                // Iteriere auch durch die Client-Metriken im Vergleichsobjekt
                if (comparisonData.clients) {
                  for (const clientMetrics of Object.values(comparisonData.clients)) {
                    delete clientMetrics.requestUrls;
                    delete clientMetrics.normalizedRequestUrls;
                  }
                }
              }
            }
          }
          fs.writeFileSync(outputPath, JSON.stringify(dataToWrite, null, 2));
          break;
        case 'csv':
          const csv = this._convertToCSV(results);
          fs.writeFileSync(outputPath, csv);
          break;
        case 'html':
          const html = this._generateHtmlReport(results);
          fs.writeFileSync(outputPath, html);
          break;
        default:
          throw new Error(`Nicht unterstütztes Format: ${format}`);
      }
      console.log(`Ergebnisse wurden nach ${outputPath} exportiert.`);
    } catch (error) {
      console.error(`Fehler beim Exportieren der Ergebnisse:`, error);
    }
  }

  // Private Hilfsmethoden
  
  /**
   * Extrahiert die Haupt-URL aus den HAR-Daten
   */
  _extractMainUrl(harData) {
    // Prefer the URL from the pages array, as it's the intended main page
    if (harData.log && harData.log.pages && harData.log.pages.length > 0) {
      // The 'title' or 'id' property of the first page is typically the main URL
      return harData.log.pages[0].title || harData.log.pages[0].id;
    }
    
    // Fallback: If no pages array, use the URL of the very first request
    if (harData.log && harData.log.entries && harData.log.entries.length > 0) {
      return harData.log.entries[0].request.url;
    }
    
    // If no pages and no entries, we cannot determine the URL
    return null;
  }

  /**
   * Zählt Antworten nach Statuscode
   */
  _countResponsesByStatusCode(harData) {
    const counts = {};
    
    for (const entry of harData.log.entries) {
      if (entry.response && entry.response.status) {
        const statusCode = entry.response.status;
        counts[statusCode] = (counts[statusCode] || 0) + 1;
      }
    }
    
    return counts;
  }

  /**
   * Zählt Fehler (4xx und 5xx Statuscodes)
   */
  _countErrors(responsesByCode) {
    let errorCount = 0;
    
    for (const [code, count] of Object.entries(responsesByCode)) {
      if (code >= 400) {
        errorCount += count;
      }
    }
    
    return errorCount;
  }

  /**
   * Berechnet Timing-Metriken
   */
  _calculateTimingMetrics(harData) {
    const timing = {
      totalDuration: 0,
      averageResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0
    };
    
    if (!harData.log.entries.length) return timing;
    
    let totalTime = 0;
    let validEntries = 0;
    
    for (const entry of harData.log.entries) {
      if (entry.time && typeof entry.time === 'number') {
        const responseTime = entry.time;
        
        totalTime += responseTime;
        validEntries++;
        
        timing.minResponseTime = Math.min(timing.minResponseTime, responseTime);
        timing.maxResponseTime = Math.max(timing.maxResponseTime, responseTime);
      }
    }
    
    if (validEntries > 0) {
      timing.averageResponseTime = totalTime / validEntries;
    }
    
    // Gesamtdauer der Seite berechnen
    if (harData.log.pages && harData.log.pages.length > 0 && harData.log.pages[0].pageTimings) {
      const pageTimings = harData.log.pages[0].pageTimings;
      timing.onLoad = pageTimings.onLoad;
      timing.onContentLoad = pageTimings.onContentLoad;
    }
    
    return timing;
  }

  /**
   * Extrahiert Synchronisations-Metriken aus HAR-Daten
   * - firstRequestStartMs: Startzeitpunkt der ersten Request relativ zum frühesten Start in dieser HAR (ms)
   * - lastRequestEndMs: Endzeitpunkt der letzten Response relativ zum frühesten Start (ms)
   * - entries: Anzahl verwendeter Einträge
   */
  _extractSyncMetrics(harData) {
    try {
      if (!harData || !harData.log || !Array.isArray(harData.log.entries) || harData.log.entries.length === 0) {
        // Falls keine Entries vorhanden sind, ggf. dennoch Visit-Start aus pages übernehmen
        const visitIso = harData?.log?.pages?.[0]?.startedDateTime || null;
        const visitMs = visitIso ? Date.parse(visitIso) : 0;
        return {
          firstRequestStartMs: 0,
          lastRequestEndMs: 0,
          absoluteStartMs: 0,
          absoluteEndMs: 0,
          durationMs: 0,
          entries: 0,
          visitStartIso: visitIso,
          visitStartMs: visitMs,
          firstRequestOffsetMs: 0,
          lastRequestOffsetMs: 0,
          onContentLoadMs: harData?.log?.pages?.[0]?.pageTimings?.onContentLoad ?? null,
          onLoadMs: harData?.log?.pages?.[0]?.pageTimings?.onLoad ?? null
        };
      }
      let earliestStart = Number.POSITIVE_INFINITY;
      let latestEnd = 0;
      let count = 0;
      for (const entry of harData.log.entries) {
        // HAR: entry.startedDateTime ist ISO, entry.timings enthält send/wait/receive
        if (!entry.startedDateTime) continue;
        const startTs = Date.parse(entry.startedDateTime);
        if (isNaN(startTs)) continue;
        const total = typeof entry.time === 'number' ? entry.time : 0;
        const endTs = startTs + Math.max(0, total);
        if (startTs < earliestStart) earliestStart = startTs;
        if (endTs > latestEnd) latestEnd = endTs;
        count++;
      }
      const visitIso = harData?.log?.pages?.[0]?.startedDateTime || null;
      const visitMs = visitIso ? Date.parse(visitIso) : (isFinite(earliestStart) ? earliestStart : 0);
      if (!isFinite(earliestStart)) {
        return {
          firstRequestStartMs: 0,
          lastRequestEndMs: 0,
          absoluteStartMs: 0,
          absoluteEndMs: 0,
          durationMs: 0,
          entries: 0,
          visitStartIso: visitIso,
          visitStartMs: visitMs,
          firstRequestOffsetMs: 0,
          lastRequestOffsetMs: 0,
          onContentLoadMs: harData?.log?.pages?.[0]?.pageTimings?.onContentLoad ?? null,
          onLoadMs: harData?.log?.pages?.[0]?.onLoad ?? harData?.log?.pages?.[0]?.pageTimings?.onLoad ?? null
        };
      }
      return {
        // Absolute Zeitmarken (Unix ms)
        firstRequestStartMs: earliestStart,
        lastRequestEndMs: latestEnd,
        absoluteStartMs: earliestStart,
        absoluteEndMs: latestEnd,
        durationMs: Math.max(0, latestEnd - earliestStart),
        entries: count,
        // Visit-Start aus pages[0]
        visitStartIso: visitIso,
        visitStartMs: visitMs,
        // Relative Offsets zum Visit-Start
        firstRequestOffsetMs: Math.max(0, earliestStart - visitMs),
        lastRequestOffsetMs: Math.max(0, latestEnd - visitMs),
        // PageTimings (bereits relativ zu startedDateTime in HAR)
        onContentLoadMs: harData?.log?.pages?.[0]?.pageTimings?.onContentLoad ?? null,
        onLoadMs: harData?.log?.pages?.[0]?.onLoad ?? harData?.log?.pages?.[0]?.pageTimings?.onLoad ?? null
      };
    } catch (e) {
      return {
        firstRequestStartMs: 0,
        lastRequestEndMs: 0,
        absoluteStartMs: 0,
        absoluteEndMs: 0,
        durationMs: 0,
        entries: 0,
        visitStartIso: null,
        visitStartMs: 0,
        firstRequestOffsetMs: 0,
        lastRequestOffsetMs: 0,
        onContentLoadMs: null,
        onLoadMs: null
      };
    }
  }

    /**
   * Analysiert Anfragen gegen EasyPrivacy (Tracking) und EasyList (Ads)
   */
    _analyzeTrackingRequests(harData) {
      if (!this.options.adBlockEnabled) return null;
  
      const pageUrl = this._extractMainUrl(harData) || undefined;
      if (this.options.verbose) {
        console.log(`[HarAnalyzer] Tracking-Analyse für ${pageUrl || 'unbekannte Seite'}`);
      }
  
      const tracking = {
        // rückwärtskompatibel:
        total: 0,                  // nur Tracking (EasyPrivacy)
        domains: {},               // nur Tracking-Domains
        // zusätzliche Felder (brechen keine Verbraucher, die nur total nutzen):
        adsTotal: 0,               // Ads (EasyList)
        adsDomains: {},
        matches: undefined, // optional: Details für Debug
      };
  
      for (const entry of harData.log.entries) {
        const res = this.adBlockList.classifyHarEntry(entry, pageUrl);
        if (!res.matched) continue;
  
        let host = '';
        try { host = new URL(res.url).hostname; } catch (_) {}
  
        if (res.category === 'tracking') {
          tracking.total++;
          if (host) tracking.domains[host] = (tracking.domains[host] || 0) + 1;
        } else if (res.category === 'ads') {
          tracking.adsTotal++;
          if (host) tracking.adsDomains[host] = (tracking.adsDomains[host] || 0) + 1;
        }
  
        if (this.options.verbose && tracking.matches) {
          tracking.matches.push({
            url: res.url,
            type: res.type,
            category: res.category,
            filter: res.filterText || null,
          });
        }
      }
  
      // Das matches-Feld vor dem Zurückgeben entfernen, um die Ausgabe sauber zu halten
      delete tracking.matches;
      return tracking;
    }

  /**
   * Analysiert Mediendateien (Bilder, Videos, Audio)
   */
  _analyzeMediaFiles(harData) {
    if (this.options.verbose) {
      console.log(`[HarAnalyzer] Running media file analysis for ${this._extractMainUrl(harData) || 'unknown URL'}`);
    }
    const mediaTypes = {
      images: 0,
      videos: 0,
      audio: 0,
      total: 0,
      size: 0
    };
    
    for (const entry of harData.log.entries) {
      if (entry.response && entry.response.content && entry.response.content.mimeType) {
        const mimeType = entry.response.content.mimeType.toLowerCase();
        const size = entry.response.content.size || 0;
        
        if (mimeType.startsWith('image/')) {
          mediaTypes.images++;
          mediaTypes.total++;
          mediaTypes.size += size;
        } else if (mimeType.startsWith('video/')) {
          mediaTypes.videos++;
          mediaTypes.total++;
          mediaTypes.size += size;
        } else if (mimeType.startsWith('audio/')) {
          mediaTypes.audio++;
          mediaTypes.total++;
          mediaTypes.size += size;
        }
      }
    }
    
    return mediaTypes;
  }

  /**
   * Berechnet eine Gesamtzusammenfassung der Ergebnisse
   */
  _calculateOverallSummary(results) {
    if (!results || !results.urls || !results.clients) {
      return {
        totalUrls: 0,
        totalClients: 0,
        clientComparison: {},
        statusCodeDistribution: {}
      };
    }
    
    const summary = {
      totalUrls: Object.keys(results.urls).length,
      totalClients: Object.keys(results.clients).length,
      clientComparison: {},
      statusCodeDistribution: {}
    };
    
    const clients = Object.keys(results.clients);
    
    if (clients.length > 0) {
      for (const client of clients) {
        const clientStats = results.clients[client];
        if (clientStats) {
          summary.clientComparison[client] = {
            avgRequestsPerUrl: clientStats.avgRequestsPerUrl || 0,
            avgErrorsPerUrl: clientStats.avgErrorsPerUrl || 0,
            totalRequests: clientStats.totalRequests || 0,
            totalErrors: clientStats.totalErrors || 0,
            urlsAnalyzed: clientStats.urlsAnalyzed || 0,
            // Add media and tracking stats to summary
            avgTrackingRequestsPerUrl: clientStats.avgTrackingRequestsPerUrl || 0,
            avgMediaFilesPerUrl: clientStats.avgMediaFilesPerUrl || 0,
            avgMediaSizePerUrl: clientStats.avgMediaSizePerUrl || 0
          };
        }
      }
      
      for (const client of clients) {
        if (results.clients[client] && results.clients[client].statusCodes) {
          const statusCodes = results.clients[client].statusCodes;
          for (const [code, count] of Object.entries(statusCodes)) {
            if (!summary.statusCodeDistribution[code]) {
              summary.statusCodeDistribution[code] = {};
            }
            summary.statusCodeDistribution[code][client] = count;
          }
        }
      }
    }
    
    return summary;
  }

  /**
   * Konvertiert Ergebnisse in CSV-Format
   */
  _convertToCSV(results) {
    // Prüfen, ob es sich um Vergleichsergebnisse handelt
    const isComparison = results.urlComparisons !== undefined;
    if (!isComparison) {
      // Dieser Fall sollte durch die Änderungen in harAnalysis.js nicht mehr eintreten,
      // aber als Fallback beibehalten.
      let csv = 'Client,URLs Analyzed,Total Requests,Avg Requests Per URL,Total Errors,Avg Errors Per URL\n';
      for (const [client, stats] of Object.entries(results.clients || {})) {
        csv += `${client},${stats.urlsAnalyzed},${stats.totalRequests},${(stats.avgRequestsPerUrl || 0).toFixed(2)},${stats.totalErrors},${(stats.avgErrorsPerUrl || 0).toFixed(2)}\n`;
      }
      return csv;
    }

    // Neue, "tidy" CSV-Logik für wissenschaftliche Analyse
    const clients = Object.keys(results.clientSummary || {});
    if (clients.length === 0) return 'url,client,requests,errors,ttfr_ms,tracking_reqs,ads_reqs\n';

    // Header
    const header = ['url', 'client', 'requests', 'errors', 'ttfr_ms', 'tracking_reqs', 'ads_reqs'];
    let csvRows = [header.join(',')];

    // Zeilen für jede URL und jeden Client erstellen
    for (const [url, comp] of Object.entries(results.urlComparisons)) {
      for (const clientName of clients) {
        const metrics = comp.clients[clientName];
        const row = [
          `"${url.replace(/"/g, '""')}"`, // URL in Anführungszeichen, falls sie Kommas enthält
          clientName
        ];

        if (metrics && !metrics.error) {
          row.push(
            metrics.totalRequests || 0,
            metrics.totalErrors || 0,
            metrics.sync?.firstRequestOffsetMs ?? 0,
            metrics.trackingRequests?.total || 0,
            metrics.trackingRequests?.adsTotal || 0
          );
        } else {
          // Fehlerfall oder fehlende Daten
          row.push('N/A', 'N/A', 'N/A', 'N/A', 'N/A');
        }
        csvRows.push(row.join(','));
      }
    }

    return csvRows.join('\n');
  }

  /**
   * Generiert einen HTML-Bericht aus den Analyseergebnissen
   * @param {Object} results - Analyseergebnisse
   * @returns {string} HTML-Bericht
   */
  _generateHtmlReport(results) {
    // Basis-HTML-Struktur
    let html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>HAR-Analyse Bericht</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          background-color: #f5f5f5;
        }
        h1, h2, h3, h4 {
          color: #2c3e50;
        }
        .container {
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          padding: 20px;
          margin-bottom: 20px;
        }
        .summary-box {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          margin-bottom: 20px;
        }
        .summary-item {
          flex: 1;
          min-width: 200px;
          background-color: #f8f9fa;
          border-left: 4px solid #3498db;
          padding: 15px;
          border-radius: 4px;
        }
        .summary-item h3 {
          margin-top: 0;
          color: #3498db;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        th, td {
          padding: 12px 15px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }
        th {
          background-color: #f2f2f2;
          font-weight: bold;
        }
        tr:hover {
          background-color: #f5f5f5;
        }
        .error {
          color: #e74c3c;
        }
        .success {
          color: #2ecc71;
        }
        .warning {
          color: #f39c12;
        }
        .chart-container {
          height: 300px;
          margin-bottom: 30px;
        }
        .url-list {
          max-height: 200px;
          overflow-y: auto;
          border: 1px solid #ddd;
          padding: 10px;
          border-radius: 4px;
          background-color: #f9f9f9;
        }
        .url-list li {
          margin-bottom: 5px;
          word-break: break-all;
        }
        .tabs {
          display: flex;
          border-bottom: 1px solid #ddd;
          margin-bottom: 20px;
        }
        .tab {
          padding: 10px 20px;
          cursor: pointer;
          background-color: #f2f2f2;
          border: 1px solid #ddd;
          border-bottom: none;
          margin-right: 5px;
          border-radius: 4px 4px 0 0;
        }
        .tab.active {
          background-color: white;
          border-bottom: 1px solid white;
          margin-bottom: -1px;
        }
        .tab-content {
          display: none;
        }
        .tab-content.active {
          display: block;
        }
      </style>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    </head>
    <body>
      <h1>HAR-Analyse Bericht</h1>
      <p>Erstellt am: ${new Date().toLocaleString('de-DE')}</p>
    `;

    // Ist es ein Vergleichsbericht oder ein detaillierter Bericht?
    const isComparison = results.urlComparisons !== undefined;

    if (isComparison) {
      // Vergleichsbericht
      html += this._generateComparisonReport(results);
    } else {
      // Detaillierter Bericht
      html += this._generateDetailedReport(results);
    }

    // JavaScript für Interaktivität
    html += `
      <script>
        // Tabs-Funktionalität
        function openTab(evt, tabName) {
          const tabContents = document.getElementsByClassName('tab-content');
          for (let i = 0; i < tabContents.length; i++) {
            tabContents[i].classList.remove('active');
          }
          
          const tabs = document.getElementsByClassName('tab');
          for (let i = 0; i < tabs.length; i++) {
            tabs[i].classList.remove('active');
          }
          
          document.getElementById(tabName).classList.add('active');
          evt.currentTarget.classList.add('active');
        }
        
        // Charts initialisieren
        document.addEventListener('DOMContentLoaded', function() {
          // Hier können Charts initialisiert werden, wenn die Seite geladen ist
          const chartElements = document.querySelectorAll('[data-chart]');
          chartElements.forEach(element => {
            const chartType = element.getAttribute('data-chart');
            const chartData = JSON.parse(element.getAttribute('data-data'));
            const chartOptions = JSON.parse(element.getAttribute('data-options') || '{}');
            
            new Chart(element, {
              type: chartType,
              data: chartData,
              options: chartOptions
            });
          });
          
          // Ersten Tab öffnen
          const firstTab = document.querySelector('.tab');
          if (firstTab) {
            firstTab.click();
          }
        });
      </script>
    </body>
    </html>
    `;

    return html;
  }

  /**
   * Generiert den Vergleichsteil des HTML-Berichts
   * @param {Object} results - Vergleichsergebnisse
   * @returns {string} HTML-Fragment
   */
  _generateComparisonReport(results) {
    let html = `
      <div class="container">
        <h2>Zusammenfassung</h2>
        <div class="summary-box">
          <div class="summary-item">
            <h3>Analysierte URLs</h3>
            <p>${results.overallSummary.totalUrls || 0}</p>
          </div>
          <div class="summary-item">
            <h3>Verglichene Clients</h3>
            <p>${results.overallSummary.totalClients || 0}</p>
          </div>
          <div class="summary-item">
            <h3>Gesamtdauer</h3>
            <p>${(results.overallSummary.crawlDurationMinutes || 0).toFixed(2)} Minuten</p>
          </div>
          <div class="summary-item">
            <h3>Ø Abweichung 1. Request</h3>
            <p>${(results.timingSpreads?.overall?.mean || 0).toFixed(1)} ms</p>
          </div>
        </div>
      </div>
    `;

    // Timing-Tabelle vor den Tabs
    html += `
    <div class="container">
        <h2>Timing-Übersicht</h2>
        <p><em>Start bis erste Netzwerkanfrage</em> = Zeit vom Visit-Signal bis zur ersten aufgezeichneten HTTP-Anfrage.</p>
        
        <h4>Statistik über alle URLs</h4>
        <table>
            <thead>
                <tr>
                    <th>Metrik</th>
                    <th>Mittelwert (ms)</th>
                    <th>Standardabweichung (ms)</th>
                    <th>Maximalwert (ms)</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Maximale Abweichung des 1. Requests pro URL (Spread)</td>
                    <td>${(results.timingSpreads?.overall?.mean || 0).toFixed(1)}</td>
                    <td>${(results.timingSpreads?.overall?.stddev || 0).toFixed(1)}</td>
                    <td>${(results.timingSpreads?.overall?.max || 0).toFixed(1)}</td>
                </tr>
            </tbody>
        </table>

        <h4>Statistik pro Client (über alle URLs)</h4>
        <table>
            <thead>
                <tr>
                    <th>Client</th>
                    <th>Start→erste Anfrage Mittel (ms)</th>
                    <th>Start→erste Anfrage StdAbw (ms)</th>
                    <th>Start→erste Anfrage Max (ms)</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(results.timingSpreads?.perClient || {}).map(([client, stats]) => `
                <tr>
                    <td>${client}</td>
                    <td>${(stats.ttfr?.mean || 0).toFixed(1)}</td>
                    <td>${(stats.ttfr?.stddev || 0).toFixed(1)}</td>
                    <td>${(stats.ttfr?.max || 0).toFixed(1)}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    `;

    // Tabs für verschiedene Vergleichsansichten
    html += `
      <div class="container">
        <h2>Client-Vergleiche</h2>
        <div class="tabs">
          <button class="tab active" onclick="openTab(event, 'tab-overview')">Übersicht</button>
          <button class="tab" onclick="openTab(event, 'tab-requests')">Anfragen</button>
          <button class="tab" onclick="openTab(event, 'tab-errors')">Fehler</button>
          <button class="tab" onclick="openTab(event, 'tab-failed-urls')">Fehlgeschlagene URLs</button>
          <button class="tab" onclick="openTab(event, 'tab-tracking')">Tracking</button>
          <button class="tab" onclick="openTab(event, 'tab-media')">Medien</button>
          <button class="tab" onclick="openTab(event, 'tab-unique-urls')">Einzigartige URLs</button>
          <button class="tab" onclick="openTab(event, 'tab-timings-detail')">Timing-Details</button>
          ${results.normalizationEnabled ? '<button class="tab" onclick="openTab(event, \'tab-normalization\')">URL-Normalisierung</button>' : ''}
        </div>
        
        <!-- Übersichts-Tab -->
        <div id="tab-overview" class="tab-content active">
          <h3>Client-Übersicht</h3>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Analysierte URLs</th>
                <th>Gesamtanfragen</th>
                <th>Durchschnitt Anfragen/URL</th>
                <th>Ø Tracking-Anfragen / URL</th>
                <th>Ø Werbe-Anfragen / URL</th>
                <th>Ø Mediendateien / URL</th>
                <th>Ø Mediengröße / URL</th>
              </tr>
            </thead>
            <tbody>
    `;

    // Hilfsfunktion zum Formatieren der Größe
    const formatBytes = (bytes, decimals = 2) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };

    // Client-Übersichtstabelle
    for (const [client, stats] of Object.entries(results.clientSummary)) {
      html += `
        <tr>
          <td>${client}</td>
          <td>${stats.urlsAnalyzed || 0}</td>
          <td>${stats.totalRequests || 0}</td>
          <td>${(stats.avgRequestsPerUrl || 0).toFixed(2)}</td>
          <td>${(stats.avgTrackingRequestsPerUrl || 0).toFixed(2)}</td>
          <td>${(stats.avgAdsRequestsPerUrl || 0).toFixed(2)}</td>
          <td>${(stats.avgMediaFilesPerUrl || 0).toFixed(2)}</td>
          <td>${formatBytes(stats.avgMediaSizePerUrl || 0)}</td>
        </tr>
      `;
    }

    html += `
            </tbody>
          </table>
        </div>
        
        <!-- Anfragen-Tab -->
        <div id="tab-requests" class="tab-content">
          <h3>Anfragenvergleich nach URL</h3>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Vergleich</th>
                <th>Differenz</th>
              </tr>
            </thead>
            <tbody>
    `;

    // Anfragenvergleichstabelle
    for (const [url, comparison] of Object.entries(results.urlComparisons)) {
      for (const [comparisonKey, diff] of Object.entries(comparison.requestDifferences)) {
        html += `
          <tr>
            <td>${url}</td>
            <td>${comparisonKey}</td>
            <td class="${diff > 0 ? 'warning' : diff < 0 ? 'error' : ''}">${diff}</td>
          </tr>
        `;
      }
    }

    html += `
            </tbody>
          </table>
        </div>
        
        <!-- Fehler-Tab -->
        <div id="tab-errors" class="tab-content">
          <h3>Fehler-Übersicht</h3>
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Gesamtfehler (4xx/5xx)</th>
                  <th>URLs mit Fehlern</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(results.errorSummary?.byClient || {}).map(([client, stats]) => `
                  <tr>
                    <td>${client}</td>
                    <td>${stats.totalErrors}</td>
                    <td>${stats.urlsWithErrors}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

          <h3>Fehlerdifferenz nach URL</h3>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Vergleich</th>
                <th>Differenz</th>
              </tr>
            </thead>
            <tbody>
    `;

    // Fehlervergleichstabelle
    for (const [url, comparison] of Object.entries(results.urlComparisons)) {
      for (const [comparisonKey, diff] of Object.entries(comparison.errorDifferences)) {
        html += `
          <tr>
            <td>${url}</td>
            <td>${comparisonKey}</td>
            <td class="${diff > 0 ? 'warning' : diff < 0 ? 'error' : ''}">${diff}</td>
          </tr>
        `;
      }
    }

    html += `
            </tbody>
          </table>
        </div>

        <!-- Fehlgeschlagene URLs Tab -->
        <div id="tab-failed-urls" class="tab-content">
            <h3>URLs ohne Requests</h3>
            <p>Die folgenden Clients haben für die jeweilige URL keine einzige Anfrage aufgezeichnet.</p>
            <table>
                <thead>
                    <tr>
                        <th>URL</th>
                        <th>Client</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.errorSummary?.failedUrls?.map(item => `
                        <tr>
                            <td>${item.url}</td>
                            <td>${item.client}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="2">Keine fehlgeschlagenen URLs gefunden.</td></tr>'}
                </tbody>
            </table>
        </div>

        <!-- Tracking-Tab -->
        <div id="tab-tracking" class="tab-content">
          <h3>Tracking-Analyse im Detail</h3>
    `;

    // Tracking-Vergleichstabellen
    for (const [url, comparison] of Object.entries(results.urlComparisons)) {
      html += `<h4>${url}</h4>`;
      
      // Detail-Tabelle
      html += `<h5>Detailansicht</h5><table><thead><tr>
        <th>Client</th>
        <th>Tracking-Anfragen (Anzahl)</th>
        <th>Anteil an Gesamt-Requests</th>
        </tr></thead><tbody>`;

      for (const [client, metrics] of Object.entries(comparison.clients)) {
        if (metrics.error) continue;
        const trackingCount = metrics.trackingRequests?.total || 0;
        const totalRequests = metrics.totalRequests || 1;
        const percentage = totalRequests > 0 ? (trackingCount / totalRequests * 100).toFixed(2) : 0;
        
        html += `
          <tr>
            <td>${client}</td>
            <td>${trackingCount}</td>
            <td>${percentage}%</td>
          </tr>
        `;
      }
      html += `</tbody></table>`;

      // Differenz-Tabelle
      html += `<h5>Differenz-Ansicht</h5><table><thead><tr>
        <th>Vergleich</th>
        <th>Differenz (Anzahl Tracking-Requests)</th>
        <th>Differenz (Anzahl Werbe-Requests)</th>
        </tr></thead><tbody>`;

      for (const [comparisonKey, diff] of Object.entries(comparison.trackingDifferences)) {
        const adsDiff = (comparison.adsDifferences || {})[comparisonKey] || 0;
        html += `
          <tr>
            <td>${comparisonKey}</td>
            <td class="${diff > 0 ? 'warning' : diff < 0 ? 'error' : ''}">${diff}</td>
            <td class="${adsDiff > 0 ? 'warning' : adsDiff < 0 ? 'error' : ''}">${adsDiff}</td>
          </tr>
        `;
      }
      html += `</tbody></table>`;
    }

    html += `</div>`;

        
    html += `
        <!-- Medien-Tab -->
        <div id="tab-media" class="tab-content">
          <h3>Medien-Analyse im Detail</h3>
    `;

    // Medien-Vergleichstabelle
    for (const [url, comparison] of Object.entries(results.urlComparisons)) {
        html += `<h4>${url}</h4><table><thead><tr>
        <th>Client</th>
        <th>Mediendateien (Anzahl)</th>
        <th>Anteil an Gesamt-Requests</th>
        <th>Gesamtgröße</th>
        </tr></thead><tbody>`;
        
        for (const [client, metrics] of Object.entries(comparison.clients)) {
            if (metrics.error) continue;
            const mediaFileCount = metrics.mediaFiles?.total || 0;
            const totalRequests = metrics.totalRequests || 1;
            const percentage = totalRequests > 0 ? (mediaFileCount / totalRequests * 100).toFixed(2) : 0;
            const mediaSize = metrics.mediaFiles?.size || 0;

            html += `
            <tr>
                <td>${client}</td>
                <td>${mediaFileCount}</td>
                <td>${percentage}%</td>
                <td>${formatBytes(mediaSize)}</td>
            </tr>
            `;
        }
        html += `</tbody></table>`;
    }

    html += `
        </div>
        
        <!-- Einzigartige URLs-Tab -->
        <div id="tab-unique-urls" class="tab-content">
          <h3>Einzigartige Request-URLs nach Client ${results.normalizationEnabled ? '(Normalisiert)' : ''}</h3>
    `;

    // Einzigartige URLs nach Client
    for (const [url, comparison] of Object.entries(results.urlComparisons)) {
      if (comparison.uniqueRequestUrls) {
        html += `<h4>${url}</h4>`;
        
        for (const [clientKey, uniqueUrls] of Object.entries(comparison.uniqueRequestUrls)) {
          if (uniqueUrls && uniqueUrls.length > 0) {
            html += `
              <div>
                <h5>${clientKey} (${uniqueUrls.length} URLs)</h5>
                <div class="url-list">
                  <ul>
            `;
            
            for (const uniqueUrl of uniqueUrls) {
              html += `<li>${uniqueUrl}</li>`;
            }
            
            html += `
                  </ul>
                </div>
              </div>
            `;
          }
        }
      }
    }

    html += `
        </div>
        
        <!-- Normalisierungs-Tab -->
        ${results.normalizationEnabled ? this._generateNormalizationReport(results.normalizationSummary) : ''}

        <!-- Timings-Detail-Tab -->
        <div id="tab-timings-detail" class="tab-content">
          <h3>Timing-Details (relativ zum Visit-Start)</h3>

          <h4>Maximale Abweichung je URL (Spread)</h4>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Spread (ms)</th>
                <th>Werte pro Client</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(results.timingSpreads?.perUrl || {}).map(([url, data]) => `
                <tr>
                  <td>${url}</td>
                  <td>${(data.spreadMs || 0).toFixed(1)}</td>
                  <td>${Object.entries(data.valuesByClient || {}).map(([c,v]) => `${c}: ${(v || 0).toFixed(1)}ms`).join(', ')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <h4>Pro URL (Start→erste Anfrage je Client)</h4>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Client</th>
                <th>Visit-Start</th>
                <th>Start→erste Anfrage (ms)</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(results.urlComparisons || {}).map(([url, comp]) => {
                const rows = [];
                for (const [client, m] of Object.entries(comp.clients || {})) {
                  const s = m.sync || {};
                  rows.push(`
                    <tr>
                      <td>${url}</td>
                      <td>${client}</td>
                      <td>${s.visitStartIso || ''}</td>
                      <td>${s.firstRequestOffsetMs ?? 0}</td>
                    </tr>
                  `);
                }
                return rows.join('');
              }).join('')}
            </tbody>
          </table>
        </div>
        
      </div>
    `;

    return html;
  }
  
  /**
   * Generiert den HTML-Teil für den Normalisierungsbericht
   * @param {Object} summary - Zusammenfassung der Normalisierungsstatistiken
   * @returns {string} HTML-Fragment
   */
  _generateNormalizationReport(summary) {
    if (!summary) return '';

    const totalReduction = summary.totalOriginalUniqueUrls - summary.totalNormalizedUniqueUrls;
    const totalReductionPercentage = summary.totalOriginalUniqueUrls > 0 
      ? (totalReduction / summary.totalOriginalUniqueUrls) * 100 
      : 0;

    let html = `
      <div id="tab-normalization" class="tab-content">
        <h3>Statistiken zur URL-Normalisierung</h3>
        <p>Die URL-Normalisierung entfernt Query-Parameter-Werte, um Anfragen auf die gleiche Ressource trotz unterschiedlicher Session-IDs zu gruppieren.</p>
        
        <div class="summary-box">
          <div class="summary-item">
            <h3>Gesamtreduktion</h3>
            <p>${totalReduction} einzigartige URLs</p>
          </div>
          <div class="summary-item">
            <h3>Reduktion in %</h3>
            <p>${totalReductionPercentage.toFixed(2)}%</p>
          </div>
        </div>

        <h4>Details pro Client</h4>
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>URLs (Original)</th>
              <th>URLs (Normalisiert)</th>
              <th>Reduktion</th>
              <th>Reduktion (%)</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const [client, stats] of Object.entries(summary.clients)) {
      const reduction = stats.originalUniqueUrls - stats.normalizedUrls;
      const reductionPercentage = stats.originalUniqueUrls > 0 
        ? (reduction / stats.originalUniqueUrls) * 100 
        : 0;
      html += `
        <tr>
          <td>${client}</td>
          <td>${stats.originalUniqueUrls}</td>
          <td>${stats.normalizedUrls}</td>
          <td>${reduction}</td>
          <td>${reductionPercentage.toFixed(2)}%</td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;
    return html;
  }
  
  /**
   * Generiert den detaillierten Teil des HTML-Berichts
   * @param {Object} results - Detaillierte Analyseergebnisse
   * @returns {string} HTML-Fragment
   */
  _generateDetailedReport(results) {
    // Diese Funktion wird nicht mehr aufgerufen, da wir nur noch Vergleichsberichte erstellen.
    // Sie kann als Referenz oder für zukünftige Erweiterungen im Code verbleiben.
    let html = `
      <div class="container">
        <h2>Detaillierter Bericht (veraltet)</h2>
        <div class="summary-box">
          <div class="summary-item">
            <h3>Analysierte URLs</h3>
            <p>${results.summary.totalUrls || 0}</p>
          </div>
          <div class="summary-item">
            <h3>Clients</h3>
            <p>${results.summary.totalClients || 0}</p>
          </div>
          <div class="summary-item">
            <h3>Zeitstempel</h3>
            <p>${new Date(results.timestamp).toLocaleString('de-DE')}</p>
          </div>
        </div>
      </div>
    `;

    // Client-Übersicht
    html += `
      <div class="container">
        <h2>Client-Übersicht</h2>
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Analysierte URLs</th>
              <th>Gesamtanfragen</th>
              <th>Fehler (4xx/5xx)</th>
              <th>Durchschnitt Anfragen/URL</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const [client, stats] of Object.entries(results.clients)) {
      html += `
        <tr>
          <td>${client}</td>
          <td>${stats.urlsAnalyzed || 0}</td>
          <td>${stats.totalRequests || 0}</td>
          <td>${stats.totalErrors || 0}</td>
          <td>${(stats.avgRequestsPerUrl || 0).toFixed(2)}</td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;

    // Detaillierte URL-Analyse
    html += `
      <div class="container">
        <h2>Detaillierte URL-Analyse</h2>
    `;

    for (const [url, urlData] of Object.entries(results.urls)) {
      html += `
        <div class="container">
          <h3>${url}</h3>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Anfragen</th>
                <th>Fehler</th>
                <th>Status-Codes</th>
              </tr>
            </thead>
            <tbody>
      `;

      for (const [client, metrics] of Object.entries(urlData.clients)) {
        if (metrics.error) {
          html += `
            <tr>
              <td>${client}</td>
              <td colspan="3" class="error">Fehler: ${metrics.error}</td>
            </tr>
          `;
        } else {
          // Status-Codes formatieren
          let statusCodesHtml = '';
          if (metrics.responsesByCode) {
            for (const [code, count] of Object.entries(metrics.responsesByCode)) {
              const codeClass = code.startsWith('2') ? 'success' : 
                               (code.startsWith('4') || code.startsWith('5')) ? 'error' : 
                               code.startsWith('3') ? 'warning' : '';
              statusCodesHtml += `<span class="${codeClass}">${code}: ${count}</span> `;
            }
          }

          html += `
            <tr>
              <td>${client}</td>
              <td>${metrics.totalRequests || 0}</td>
              <td>${metrics.totalErrors || 0}</td>
              <td>${statusCodesHtml}</td>
            </tr>
          `;
        }
      }

      html += `
            </tbody>
          </table>
        </div>
      `;
    }

    html += `</div>`;

    return html;
  }

  /**
   * Normalisiert eine URL, indem Query-Parameter-Werte entfernt werden.
   * z.B. https://example.com/page?id=123&user=abc -> https://example.com/page?id=&user=
   * @param {string} urlString - Die zu normalisierende URL
   * @returns {string} Die normalisierte URL
   */
  _normalizeUrl(urlString) {
    try {
      const url = new URL(urlString);
      const params = new URLSearchParams();
      
      for (const key of url.searchParams.keys()) {
        params.append(key, '');
      }
      
      url.search = params.toString();
      return url.toString();
    } catch (error) {
      // Wenn die URL ungültig ist, geben wir sie unverändert zurück
      return urlString;
    }
  }

  /**
   * Extrahiert alle Request-URLs aus einer HAR-Datei
   * @param {Object} harData - Geparste HAR-Daten
   * @returns {Array} Liste aller Request-URLs
   */
  _extractRequestUrls(harData) {
    if (!harData || !harData.log || !harData.log.entries) {
      return [];
    }
    
    return harData.log.entries.map(entry => entry.request.url);
  }

  /**
   * Extrahiert die Domain aus einer URL
   * @param {string} url - URL
   * @returns {string} Domain oder leerer String bei Fehlern
   */
  _extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return '';
    }
  }
}

module.exports = HarAnalyzer;
