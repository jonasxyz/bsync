const io = require("socket.io-client");
const fs = require('fs').promises;
const path = require('path');
var spawnedScripts = require("./functions/spawnScripts.js");
const ProxyManager = require('./functions/proxyManager.js'); // Import ProxyManager

const config = require("./config.js");
const { url } = require("inspector");
const masterAdress = config.activeConfig.base.master_addr;
const workerConfig = config.activeConfig.worker; // worker in workerConfig umbenannt für Klarheit
const baseConfig = config.activeConfig.base;
//var config = require("../config_openwpm.js");

const { colorize } = require("./functions/spawnScripts.js"); // Colorize function for terminal output

const os = require('os');

let proxyManager; // ProxyManager Instanz
let socket; // Socket-Variable hier deklarieren, damit sie im Modul-Scope zugänglich ist

const dirName = 0;

var crawlTimestamp;

var waitingTime = 0;

// Funktion, um den Socket zu initialisieren und Event-Handler zu registrieren
function initializeSocket() {
    socket = io(masterAdress,{
        "reconnection" : true,
        "reconnectionDelay" : 1000,
        "timeout" : 5000
    });

    console.log(colorize("INFO:", "gray") + " Worker Client starting");
    console.log(colorize("INFO:", "gray") + " Trying to connect to master server...");

    socket.on("connect", data => {
        console.log(colorize("SOCKETIO:", "cyan") + " Client " + socket.id+" succesfully connected");

        // console.log("Client session id: " + socket.sessionid); // debug
        socket.emit("initialization", workerConfig.client_name);

        // ProxyManager initialisieren, nachdem die Verbindung zum Master steht und Configs geladen sind
        if (!proxyManager) {
            proxyManager = new ProxyManager(workerConfig, baseConfig, workerConfig.client_name);
            setupProxyManagerEventHandlers();
        }
    });

    // Event-Handler für spawnedScripts interne Events
    spawnedScripts.internalEventEmitter.on('url_done_internal', async (data) => {
        console.log(colorize("WORKER_INTERNAL:", "blue") + ` 'url_done_internal' received for ${data.clearUrl}`);
        socket.emit("URL_DONE");
        if (workerConfig.enable_proxy && proxyManager && proxyManager.proxyReady) {
            try {
                console.log(colorize("PROXY_MANAGER:", "magenta") + ` Requesting HAR export for ${data.clearUrl} after URL_DONE.`);
                await proxyManager.requestHarExport();
                // Das 'harExportComplete' Event vom ProxyManager wird dann ITERATION_DONE auslösen
            } catch (err) {
                console.error(colorize("PROXY_MANAGER_ERROR:", "red") + ` Failed to request HAR export for ${data.clearUrl}:`, err.message);
                // Wenn HAR-Export fehlschlägt, müssen wir entscheiden, ob ITERATION_DONE trotzdem gesendet wird
                // oder ein Fehler gemeldet wird. Fürs Erste wird ITERATION_DONE nicht gesendet bei Fehler hier.
                // Ggf. non-persistent Proxy hier trotzdem herunterfahren, falls nötig.
                if (!baseConfig.persistent_proxy && proxyManager) {
                    console.warn(colorize("PROXY_MANAGER:", "yellow") + " Shutting down non-persistent proxy after HAR export request failure.");
                    await proxyManager.shutdown().catch(e => console.error("Error shutting down non-persistent proxy after export failure:", e));
                }
                 // Sende trotzdem ITERATION_DONE, damit der Crawl nicht hängen bleibt, aber logge den Fehler.
                console.error(colorize("WORKER_ERROR:", "red") + " HAR export failed, but sending ITERATION_DONE to prevent stall.");
                socket.emit("ITERATION_DONE");
            }
        }
    });

    spawnedScripts.internalEventEmitter.on('browser_finished_internal', () => {
        console.log(colorize("WORKER_INTERNAL:", "blue") + " 'browser_finished_internal' received.");
        // Hier könnte Logik stehen, die spezifisch nach dem vollständigen Abschluss des Browsers ausgeführt wird,
        // aber vor dem Senden von ITERATION_DONE (welches jetzt von harExportComplete abhängt).
    });

    spawnedScripts.internalEventEmitter.on('browser_ready_internal', (clientName) => {
        console.log(colorize("WORKER_INTERNAL:", "blue") + ` 'browser_ready_internal' received from ${clientName}.`);
        socket.emit("browser_ready", clientName);
    });

    socket.on("close", async data => {
        if (data == "toomanyclients") {
            console.log(colorize("ERROR:", "red") + " Too many clients connected. Check num_slaves argument on master server");
        }
        if (data == "finished") {
            console.log(colorize("STATUS:", "green") + " Crawl successfully finished");
        }
        if (data == "cancel") {
            console.log(colorize("STATUS:", "green") + " Crawl was cancelled");
        }
        console.log(colorize("INFO:", "gray") + " Shutting down...");
        if (proxyManager) {
            await proxyManager.shutdown().catch(e => console.error("Error shutting down proxyManager:", e));
        }
        process.exit();
    });

    socket.on("disconnect", () =>{
        console.log(colorize("SOCKETIO:", "cyan") + colorize(" Lost connection to master server.", "red"));
    });

    socket.io.on("reconnect", (attempt)=>{
        console.log(colorize("SOCKETIO:", "cyan") + " Automatic reconnection successfull on " +attempt +". attempt.");
    });

    socket.io.on("reconnect_attempt", (attempt)=>{
        console.log(colorize("SOCKETIO:", "cyan") + " Trying to reconnect.");
    });

    socket.on("ping", function(){
        console.log(colorize("SOCKETIO:", "cyan") + " Testing latency to master server...");
        socket.emit("pingresults", workerConfig.client_name);
    })

    // Receive crawl timestamp from scheduler for har remote storage path
    socket.on("crawlRootDir", async (data) => {
        // console.log("INFO: " + "Received crawl timestamp from master: " + data); // DEBUG
        crawlTimestamp = data.toString();

        // Die Variable mainCrawlDir wird nun hier korrekt initialisiert.
        const mainCrawlDir = path.join(workerConfig.har_destination, crawlTimestamp);
        console.log(colorize("WORKER:", "cyan") + ` Received crawlRootDir. Main crawl directory will be: ${mainCrawlDir}`);

        try {
            // Stelle sicher, dass das Verzeichnis existiert. fs.mkdir mit recursive:true
            // erstellt es, falls es nicht existiert, und wirft keinen Fehler, wenn es bereits existiert.
            await fs.mkdir(mainCrawlDir, { recursive: true });
            console.log(colorize("STATUS:", "green") + ` Ensured main crawl directory exists: ${mainCrawlDir}`);

            // WICHTIG: crawlDir in spawnScripts.js setzen
            spawnedScripts.setGlobalCrawlDir(mainCrawlDir);
            // Das console.log für setGlobalCrawlDir ist bereits in der Funktion selbst in spawnScripts.js

            // Optional: ProxyManager informieren, dass das Crawl-Verzeichnis bereit ist.
            // Fürs Erste gehen wir davon aus, dass crawlTimestamp direkt in constructHarPath verwendet wird.
            // Eine explizite Benachrichtigung ist nicht unbedingt nötig, wenn die Logik robust ist.

        } catch (error) {
            console.error(colorize("ERROR:", "red") + " Error creating/setting main crawl directory:", error);
            // Hier sollte der Worker ggf. einen Fehler an den Scheduler senden oder sich beenden,
            // da ohne ein gültiges Crawl-Verzeichnis viele Operationen fehlschlagen werden.
            socket.emit("worker_error", {
                type: "crawl_dir_creation_failed",
                message: `Failed to create or set main crawl directory: ${mainCrawlDir}. Error: ${error.message}`,
                client: workerConfig.client_name
            });
            // Ggf. return oder throw error, um weitere Ausführung zu stoppen, wenn das Verzeichnis kritisch ist.
        }
    });

    socket.on("initiate_crawler", async data => {
        console.log("\n" + colorize("SOCKETIO:", "cyan") + " Received Signal initiate_crawler, Crawl started at scheduler");

        console.log(colorize("INFO:", "gray") + " Starting "+ workerConfig.client_name );
        spawnedScripts.spawnCrawler();

        // Proxy wird nun separat gestartet, falls aktiviert und persistent
        if (workerConfig.enable_proxy && baseConfig.persistent_proxy) {
            if (proxyManager) {
                try {
                    console.log(colorize("STATUS:", "green") + " Starting persistent proxy via ProxyManager...");
                    await proxyManager.start();
                    // Nach dem Start des persistenten Proxys könnte ein initialer HAR-Pfad gesetzt werden,
                    // aber das ist meist URL-spezifisch und passiert in CHECK_READY.
                } catch (err) {
                    console.error(colorize("PROXY_MANAGER_ERROR:", "red") + " Failed to start persistent proxy:", err);
                    // Ggf. Fehler an Scheduler melden
                }
            } else {
                console.error(colorize("ERROR:", "red") + " ProxyManager not initialized for persistent proxy.");
            }
        }
    });

    socket.on("start_capturer", async data => {
        console.log(colorize("SOCKETIO:", "cyan") + " Received Signal start_capturer, starting capturing method");
        const clearUrlForHar = data; // Annahme: data ist hier die clearUrl

        if (!crawlTimestamp) {
            console.error(colorize("ERROR:", "red") + ` crawlTimestamp is not set in start_capturer. Cannot set HAR path for ${clearUrlForHar}. Ensure 'crawlRootDir' event is received first.`);
            if (workerConfig.enable_tcpdump) {
                console.log(colorize("TCPDUMP:", "blue") + " Attempting to start tcpdump even though crawlTimestamp is missing (may use fallback paths).");
                await spawnedScripts.spawnDump(clearUrlForHar);
            }
            return;
        }

        if (workerConfig.enable_proxy && baseConfig.persistent_proxy) {
            if (proxyManager && proxyManager.proxyReady) {
                console.log(colorize("STATUS:", "green") + " Persistent proxy already running. Setting HAR dump path for first URL.");
                const harPath = await constructHarPath(clearUrlForHar, crawlTimestamp);
                if (harPath) {
                    try {
                        await proxyManager.setHarPath(harPath);
                    } catch (err) {
                        console.error(colorize("PROXY_MANAGER_ERROR:", "red") + ` Failed to set initial HAR path for ${clearUrlForHar}:`, err);
                    }
                } else {
                    console.warn(colorize("PROXY_MANAGER:", "yellow") + ` HAR path construction failed for ${clearUrlForHar} in start_capturer (proxy ready), not setting path.`);
                }
            } else if (proxyManager) { // ProxyManager existiert, aber nicht ready (oder Start fehlgeschlagen)
                console.warn(colorize("PROXY_MANAGER:", "yellow") + " Persistent proxy was expected but is not ready. Attempting to start...");
                try {
                    await proxyManager.start();
                    const harPath = await constructHarPath(clearUrlForHar, crawlTimestamp);
                    if (harPath) {
                        await proxyManager.setHarPath(harPath);
                    } else {
                        console.warn(colorize("PROXY_MANAGER:", "yellow") + ` HAR path construction failed for ${clearUrlForHar} in start_capturer (proxy not ready), not setting path.`);
                    }
                } catch (err) {
                    console.error(colorize("PROXY_MANAGER_ERROR:", "red") + ` Failed to start/set HAR path for persistent proxy and ${clearUrlForHar}:`, err);
                }
            } else {
                console.error(colorize("ERROR:", "red") + " ProxyManager not initialized for persistent proxy.");
            }
        } 
        // Non-persistent Proxy wird in CHECK_READY gestartet

        if (workerConfig.enable_tcpdump) await spawnedScripts.spawnDump(clearUrlForHar);

    });

    socket.on("CHECK_READY", async data => {
        console.log(colorize("SOCKETIO:", "cyan") + " CHECK_READY Received. Next url: " + data + "");
        const clearUrlForHar = data; // Annahme: data ist hier die clearUrl

        if (!crawlTimestamp) {
            console.error(colorize("ERROR:", "red") + ` crawlTimestamp is not set in CHECK_READY. Cannot set HAR path for ${clearUrlForHar}. Ensure 'crawlRootDir' event is received first.`);
            // Browser trotzdem prüfen, aber ohne HAR-Pfad-Setzung, da dies fehlschlagen würde.
            // TCPDump könnte auch fehlschlagen oder Fallback-Pfade verwenden, wenn es von crawlDir in spawnScripts abhängt.
            if (workerConfig.enable_tcpdump) {
                console.log(colorize("TCPDUMP:", "blue") + " Attempting to start tcpdump in CHECK_READY even though crawlTimestamp is missing (may use fallback paths).");
                await spawnedScripts.spawnDump(clearUrlForHar);
            }
            spawnedScripts.checkBrowserReady();
            return;
        }

        if (workerConfig.enable_proxy) {
            if (!proxyManager) {
                console.error(colorize("ERROR:", "red") + " ProxyManager not initialized in CHECK_READY.");
                // Hier könnte ein Fehler an den Scheduler gesendet werden.
                spawnedScripts.checkBrowserReady(); // Browser trotzdem prüfen
                return;
            }

            if (baseConfig.persistent_proxy) {
                if (!proxyManager.proxyReady) {
                    console.warn(colorize("PROXY_MANAGER:", "yellow") + " Persistent proxy not ready, attempting to ensure it is started.");
                    try {
                        await proxyManager.start(); // Stellt sicher, dass er läuft oder versucht zu starten
                    } catch (err) {
                        console.error(colorize("PROXY_MANAGER_ERROR:", "red") + " Failed to ensure persistent proxy is running:", err);
                        // Fahren Sie trotzdem mit dem Browser fort, aber Proxy-Funktionalität ist möglicherweise beeinträchtigt
                        spawnedScripts.checkBrowserReady();
                        return;
                    }
                }
                // HAR-Pfad für die neue URL setzen (auch wenn Proxy schon lief)
                const harPath = await constructHarPath(clearUrlForHar, crawlTimestamp);
                if (harPath) {
                    try {
                        await proxyManager.setHarPath(harPath);
                    } catch (err) {
                        console.error(colorize("PROXY_MANAGER_ERROR:", "red") + ` Failed to set HAR path for ${clearUrlForHar}:`, err);
                    }
                } else {
                    console.warn(colorize("PROXY_MANAGER:", "yellow") + ` HAR path construction failed for ${clearUrlForHar} in CHECK_READY (persistent proxy), not setting path.`);
                }
            } else { // Non-persistent proxy
                console.log(colorize("STATUS:", "green") + " Starting non-persistent proxy via ProxyManager...");
                try {
                    await proxyManager.start(); // Startet den Proxy für diese URL
                    const harPath = await constructHarPath(clearUrlForHar, crawlTimestamp);
                    if (harPath) {
                        await proxyManager.setHarPath(harPath);
                    } else {
                        console.warn(colorize("PROXY_MANAGER:", "yellow") + ` HAR path construction failed for ${clearUrlForHar} in CHECK_READY (non-persistent proxy), not setting path.`);
                    }
                } catch (err) {
                    console.error(colorize("PROXY_MANAGER_ERROR:", "red") + ` Failed to start/set HAR path for non-persistent proxy and ${clearUrlForHar}:`, err);
                    // Fahren Sie trotzdem mit dem Browser fort
                }
            }
        }

        if (workerConfig.enable_tcpdump) await spawnedScripts.spawnDump(clearUrlForHar);

        // Optional: Alte Flows löschen, bevor der Browser startet
        if (proxyManager && proxyManager.proxyReady) {
            // proxyManager.clearFlows().catch(e => console.warn("Could not clear flows:", e.message));
        }

        spawnedScripts.checkBrowserReady();
    });

    socket.on("visit_url", async data => {
        console.log(colorize("SOCKETIO:", "cyan") + " Job received (Signal url) " + data);

        // Create parameters for each URL
        const config = createUrlIterationConfig(data);

        // Spawn capturer moved to back

        spawnedScripts.sendVisitUrlCommand(config);

        // if (browser && browser.stdin) {

        //   let jsonSignal = "visit_url " + JSON.stringify(config) + "\n";
        //   browser.stdin.write(jsonSignal);
        // } else {
        //   console.error("Browser process is not available.");
        // }
    });

    socket.on("killchildprocess", async data => {
        console.log(colorize("SOCKETIO:", "cyan") + " Signal killchildprocess received from Scheduler");
        const exiting = data.toString() !== "timeout";

        await spawnedScripts.cleanupProcesses(exiting); // Browser-Prozesse

        if (workerConfig.enable_proxy && proxyManager) {
            console.log(colorize("PROXY_MANAGER:", "magenta") + (exiting ? " Shutting down proxy due to exit signal." : " Shutting down proxy due to timeout."));
            await proxyManager.shutdown().catch(e => console.error("Error shutting down proxyManager during killchildprocess:", e));
        }
    });

    // Distribute waiting time to all workers
    socket.on("waitingtime", data => {
        console.log(colorize("SOCKETIO:", "cyan") + " Signal waitingtime received");
        waitingTime = data;
        console.log(colorize("INFO:", "gray") + " Calibration done: Waiting " +waitingTime +" ms before each website visit.");
    });
}

function setupProxyManagerEventHandlers() {
    if (!proxyManager) return;

    proxyManager.on('ready', () => {
        console.log(colorize("PROXY_MANAGER:", "green") + " Proxy is ready for operations.");
        // Hier könnte eine Benachrichtigung an den Scheduler gesendet werden, falls erforderlich,
        // oder ein interner Status aktualisiert werden.
    });

    proxyManager.on('close', (code) => {
        console.log(colorize("PROXY_MANAGER:", "yellow") + ` Proxy process closed with code ${code}.`);
        // Ggf. Fehlerbehandlung oder Neustart-Logik
    });

    proxyManager.on('error', (err) => {
        console.error(colorize("PROXY_MANAGER_ERROR:", "red") + " ", err.message);
        // Schwere Fehler könnten einen Neustart des Proxys oder des Workers erfordern.
        // socket.emit("worker_error", { type: "proxy_error", message: err.message });
    });

    proxyManager.on('disconnect', () => {
        console.warn(colorize("PROXY_MANAGER:", "red") + " WebSocket disconnected from mitmproxy. Proxy communication lost.");
        // Hier könnte eine Logik zum erneuten Verbinden oder zum Melden eines kritischen Fehlers stehen.
    });

    proxyManager.on('harPathSet', (data) => {
        console.log(colorize("PROXY_MANAGER:", "magenta") + ` HAR path set in proxy: ${data.path} (Status: ${data.status})`);
    });

    proxyManager.on('firstWebsiteRequest', (data) => {
        console.log(colorize("PROXY_MANAGER:", "magenta") + 
            ` First website request captured by proxy: ${data.method} ${data.url} at ${data.timestamp}`);
        // Diese Daten für das zentrale Logging verwenden
        // socket.emit("proxy_event_log", data);
    });

    proxyManager.on('flowUpdate', (data) => {
        console.log(colorize("PROXY_MANAGER:", "magenta") + 
            ` Proxy Flow Update: Count=${data.count}, Last URL=${data.url}`);
        // Diese Daten für das zentrale Logging verwenden
        // socket.emit("proxy_event_log", data);
    });

    proxyManager.on('harExportComplete', async (data) => { // async hinzugefügt
        console.log(colorize("PROXY_MANAGER:", "green") + 
            ` HAR export completed for ${data.path}. Flows: ${data.flow_count_exported}. Size: ${data.file_size_pretty || (data.file_size_bytes !== undefined ? data.file_size_bytes + ' bytes' : 'N/A')}. Status: ${data.status}`); // Dateigröße hinzugefügt
        
        if (data.status === 'success' && data.flow_count_exported >= 0 && baseConfig.nfs_remote_filestorage) { // >=0, um auch leere HARs (0 Flows, 0 Bytes) zu behandeln
            console.log(colorize("WORKER:", "cyan") + " Triggering HAR save to NFS.");
            await saveHarToNfs(data.path, crawlTimestamp, workerConfig.client_name, baseConfig); 
        }

        // Sende ITERATION_DONE an den Scheduler
        console.log(colorize("SOCKETIO:", "cyan") + " Sending ITERATION_DONE after HAR export.");
        console.log("\n---------------------------------------------------\n");
        socket.emit("ITERATION_DONE");

        // Non-persistent Proxy nach erfolgreichem Export herunterfahren
        if (!baseConfig.persistent_proxy && proxyManager) {
            console.log(colorize("PROXY_MANAGER:", "magenta") + " Shutting down non-persistent proxy after HAR export.");
            try {
                await proxyManager.shutdown();
            } catch (e) {
                console.error(colorize("PROXY_MANAGER_ERROR:", "red") + "Error shutting down non-persistent proxy after export:", e);
            }
        }
    });

    proxyManager.on('flowsCleared', (data) => {
        console.log(colorize("PROXY_MANAGER:", "magenta") + 
            ` Proxy flows cleared. Reason: ${data.reason}, Count now: ${data.count}`);
    });

    proxyManager.on('proxy_event', (message) => {
        if (message.event === "MITMPROXY_READY") {
            // Wird bereits durch 'ready' Event abgedeckt, aber gut für detaillierteres Logging.
            console.log(colorize("PROXY_MANAGER_EVENT:", "blue") + ` Mitmproxy component fully ready.`);
        }
        // Andere generische Proxy-Events hier behandeln
    });

    // Weitere spezifische Event-Handler nach Bedarf
}

// socket.on("url", async data => {

//   console.log("\n\n\x1b[36mSOCKETIO:\x1b[0m Job received (Signal url) " + data );
//   //console.log("\n\njob received " + data);


//   // spawn browser with paramters for calibration, test or normal crawl
//   if (data.toString() === "calibration") {

//     spawnedScripts.spawnCrawler(masterAdress, worker.proxy_host, worker.client_name, 0, "calibration");

//   }else if (data.toString() === "test") {

//     spawnedScripts.spawnCrawler(masterAdress, worker.proxy_host, worker.client_name, waitingTime, "calibration");

//   }else {

//     // For now puppeteer does not append the protocol automatically  https://pptr.dev/api/puppeteer.page.goto

//     if (!/^(?:f|ht)tps?\:\/\//.test(data)) {
//       url = "http://" + data;
//     } else {
//       url = data;
//     } 

//     spawnedScripts.spawnCrawler( url, worker.proxy_host, "False", waitingTime, data);

//   }

//   // Spawn capturer moved to back
//   if (worker.enable_proxy) await spawnedScripts.spawnProxy(data);
//   if (worker.enable_tcpdump) await spawnedScripts.spawnDump(data);

// })

function createUrlIterationConfig(data) {
    const clearUrlForPath = sanitizePathComponent(data);
    const config = {
        url: '',
        userAgent: null,
        waitingTime: 0,
        clearUrl: data,
        visitDuration: baseConfig.pagevisit_duration,
        restart: false,
        // Eindeutiger Pfad für Browserdaten, nutzt crawlTimestamp und die bereinigte URL
        crawlDataPath: path.join(workerConfig.har_destination, crawlTimestamp, clearUrlForPath, 'browser_data') 
    };

    if (data.toString() === "calibration") { 
        config.url = masterAdress + "/client/" + (socket ? socket.id : 'unknown_socket'); // socket.id verwenden
        config.userAgent = workerConfig.client_name;
        config.visitDuration = 2;

    } else if (data.toString() === "test") {
        config.url = masterAdress + "/client/" + (socket ? socket.id : 'unknown_socket'); // socket.id verwenden
        config.userAgent = workerConfig.client_name;
        config.waitingTime = waitingTime;
        config.visitDuration = 2;
        
    } else {
        config.url = normalizeUrl(data);
        config.userAgent = "False";
        config.waitingTime = waitingTime;
    }

    return config;
}

// socket.on("url", async data => {
//   console.log("\n\n\x1b[36mSOCKETIO:\x1b[0m Job received (Signal url) " + data);


//   spawnedScripts.spawnCrawler(config);

//   // Spawn capturer moved to back
//   if (worker.enable_proxy) await spawnedScripts.spawnProxy(data);
//   if (worker.enable_tcpdump) await spawnedScripts.spawnDump(data);

 
// });


// For now puppeteer does not append the protocol automatically https://pptr.dev/api/puppeteer.page.goto
function normalizeUrl(data) {
    if (!/^(?:f|ht)tps?\:\/\//.test(data)) {
        return "http://" + data;
    }
    return data;
}

// Hilfsfunktion zum Erstellen des HAR-Pfades (ähnlich zu alter Logik in spawnScripts)
// Diese Funktion sollte idealerweise in proxyManager.js oder einer gemeinsamen Hilfsdatei sein,
// aber für den Moment hier, um Abhängigkeiten gering zu halten.

// Sicherere Methode, um einen Dateinamen/Pfadkomponente zu erstellen:
function sanitizePathComponent(str) {
    if (!str || typeof str !== 'string') return 'default_path_component';
    let component = str.replace(/:\/\//g, '_'); // Ersetzt :// durch _ (z.B. http_www.example.com)
    component = component.replace(/[^a-zA-Z0-9.\-_]/g, '_'); // Erlaubt alphanumerische Zeichen, Punkt, Bindestrich, Unterstrich
    component = component.replace(/__+/g, '_'); // Reduziert mehrere Unterstriche zu einem
    component = component.replace(/^_+\|_+$/g, ''); // Entfernt führende/nachfolgende Unterstriche
    return component || 'sanitized_component'; // Fallback, falls String leer wird
}

async function constructHarPath(clearUrl, crawlDirTimestampFromScheduler) {
    if (!clearUrl || !crawlDirTimestampFromScheduler) {
        console.error(colorize("ERROR:", "red") + " Cannot construct HAR path: clearUrl or crawlTimestamp is missing.");
        console.error(colorize("DEBUG:", "gray") + ` clearUrl was: '${clearUrl}', crawlTimestamp was: '${crawlDirTimestampFromScheduler}'`);
        return null;
    }
    const safeUrlName = sanitizePathComponent(clearUrl);
    const baseHarDestination = workerConfig.har_destination;
    const crawlDir = path.join(baseHarDestination, crawlDirTimestampFromScheduler);
    const urlSpecificDir = path.join(crawlDir, safeUrlName);
    
    try {
        // Stelle sicher, dass das URL-spezifische Verzeichnis existiert.
        await fs.mkdir(urlSpecificDir, { recursive: true });
        console.log(colorize("INFO:", "gray") + " Ensured directory for HAR exists: " + urlSpecificDir);
    } catch (err) {
        console.error(colorize("ERROR:", "red") + " Error creating directory for HAR: " + urlSpecificDir, err);
        return null;
    }
    return path.join(urlSpecificDir, safeUrlName + ".har");
}

// Hilfsfunktion zum Speichern von HAR-Dateien auf NFS
async function saveHarToNfs(localHarPath, crawlDirTimestamp, clientName, baseCfg) {
    if (!baseCfg.nfs_remote_filestorage || !localHarPath) {
        console.log(colorize("NFS_SAVE:", "gray") + " NFS storage is disabled or local HAR path is missing. Skipping save.");
        return;
    }

    try {
        // Überprüfe, ob die lokale HAR-Datei existiert, bevor fortgefahren wird.
        await fs.access(localHarPath, fs.constants.F_OK);
    } catch (err) {
        console.error(colorize("NFS_SAVE_ERROR:", "red") + ` Local HAR file not found or not accessible: ${localHarPath}`);
        // Sende Fehler an den Master, falls Socket verfügbar
        if (socket && socket.connected) {
            socket.emit("worker_error", {
                type: "nfs_save_error_local_file_missing",
                message: `Local HAR file not found: ${localHarPath}`,
                client: workerConfig.client_name // workerConfig muss im Scope sein
            });
        }
        return;
    }
    
    const localFileName = path.basename(localHarPath);
    // Der Zielpfad auf dem NFS-Server: <nfs_server_path>/<crawlDirTimestamp>/<clientName>/<localFileName>
    const remoteDir = path.join(baseCfg.nfs_server_path, crawlDirTimestamp, clientName);
    const remoteHarPath = path.join(remoteDir, localFileName);

    console.log(colorize("NFS_SAVE:", "cyan") + ` Attempting to save HAR to NFS: ${localHarPath} -> ${remoteHarPath}`);

    try {
        await fs.mkdir(remoteDir, { recursive: true });
        console.log(colorize("NFS_SAVE:", "gray") + ` Ensured remote directory exists: ${remoteDir}`);

        await fs.copyFile(localHarPath, remoteHarPath);
        console.log(colorize("NFS_SAVE:", "green") + ` HAR file successfully copied to NFS: ${remoteHarPath}`);

        if (baseCfg.delete_after_upload) {
            await fs.unlink(localHarPath);
            console.log(colorize("NFS_SAVE:", "gray") + ` Local HAR file deleted: ${localHarPath}`);
        }

    } catch (err) {
        console.error(colorize("NFS_SAVE_ERROR:", "red") + ` Failed to save HAR to NFS or delete local file: ${err.message}`);
        console.error(colorize("NFS_SAVE_DEBUG:", "gray") + ` Error details: `, err);
        if (socket && socket.connected) {
            socket.emit("worker_error", {
                type: "nfs_save_failed",
                message: `Failed to save HAR ${localHarPath} to NFS: ${err.message}`,
                localPath: localHarPath,
                remotePath: remoteHarPath,
                client: workerConfig.client_name // workerConfig muss im Scope sein
            });
        }
    }
}

// Initialisiere den Socket beim Start des Workers
initializeSocket();

// Graceful shutdown
async function gracefulShutdown() {
    console.log(colorize("WORKER:", "yellow") + " Attempting graceful shutdown...");
    if (socket && socket.connected) {
        socket.disconnect();
    }
    await spawnedScripts.cleanupProcesses(true); // Cleanup browser processes
    if (proxyManager) {
        await proxyManager.shutdown().catch(e => console.error("Error during proxyManager shutdown:", e));
    }
    console.log(colorize("WORKER:", "green") + " Graceful shutdown complete. Exiting.");
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

process.on('uncaughtException', async (err) => {
    console.error(colorize("WORKER_ERROR:", "red") + ' Uncaught Exception:', err);
    // Sende Fehler an den Master, bevor der Worker herunterfährt
    if (socket && socket.connected) {
        socket.emit("worker_error", { 
            type: "uncaught_exception", 
            message: err.message, 
            stack: err.stack, 
            client: workerConfig.client_name 
        });
    }
    await gracefulShutdown(); 
});
process.on('unhandledRejection', async (reason, promise) => {
    console.error(colorize("WORKER_ERROR:", "red") + ' Unhandled Rejection at:', promise, 'reason:', reason);
    if (socket && socket.connected) {
        socket.emit("worker_error", { 
            type: "unhandled_rejection", 
            reason: reason instanceof Error ? reason.message : String(reason), 
            client: workerConfig.client_name 
        });
    }
    await gracefulShutdown();
});

