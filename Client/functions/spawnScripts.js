const {spawn} = require('child_process');
const path = require('path');
var exkill = require("tree-kill");
var fs = require('fs');
const EventEmitter = require('events');
// const axios = require('axios'); // Nicht mehr für Proxy-Steuerung benötigt
// const FormData = require('form-data'); // Nicht mehr für Proxy-Steuerung benötigt

const crawlEnvInfo = require("./crawlEnvInfo.js");

var dataGathered = false;

const config = require("../config.js");
const worker = config.activeConfig.worker;
const baseConfig = config.activeConfig.base;

const fileformat = path.extname(worker.crawl_script);

var childExists = false;
var isCancelled = false;

var crawlDir; // Hauptverzeichnis für den aktuellen Crawl (von Scheduler erhalten)
var dirCreated = false; // Status, ob das Haupt-Crawl-Verzeichnis bekannt/erstellt ist
// var dirTimestamp; // Wird durch crawlDir (via crawlTimestamp vom Scheduler) abgedeckt
var urlSaveDir; // Spezifisches Verzeichnis für eine URL, falls von Browser-Skripten benötigt
// var crawlDirTimestamp; // In crawlDir enthalten

var browser;
// var proxy; // Entfernt, wird durch ProxyManager in worker.js gehandhabt

let visitedUrl; // Wird weiterhin für Browser-Logik benötigt

// var harPathGlobal = null; // Entfernt, wird durch ProxyManager in worker.js gehandhabt

// var browserFinished = false; // Nicht mehr als globale Variable benötigt, Event-basiert

const internalEventEmitter = new EventEmitter(); // Hinzugefügt

// Helper function for colored console output - bleibt hier, da es auch vom Browser-Logging genutzt wird
const colors = {
    reset: "\x1b[0m",
    fg: {
        black: "\x1b[30m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
        gray: "\x1b[90m"
    }
};

// Farbfunktion definieren
function colorize(text, color) {
    return colors.fg[color] + text + colors.reset;
}

module.exports =
{
    spawnCrawler: async function () {
        // config Destrukturierung bleibt, da für Browser-Argumente genutzt
        let { url, proxyHost, userAgent, waitingTime, clearUrl, headless } = config; 

        if(worker.enable_tcpdump){ 
            // Die Logik für tcpdump und SSLKEYLOGFILE bleibt weitgehend unberührt,
            // da sie nicht direkt mit der mitmproxy-Steuerung zusammenhängt.
            // Es muss aber sichergestellt werden, dass `urlSaveDir` korrekt gesetzt wird.
            // createUrlDir wird weiterhin benötigt, wenn SSLKEYLOGFILE pro URL gespeichert wird.
            
            // Wenn `crawlDir` noch nicht gesetzt ist (sollte durch `createDir` beim Worker-Start passieren),
            // dann hier ggf. einen Fallback oder Fehler werfen.
            if (!crawlDir) {
                console.error(colorize("ERROR:", "red") + " crawlDir not set. Cannot create URL specific dir for SSLKEYLOGFILE.");
                // Hier könnte ein Standardpfad gesetzt oder der Vorgang abgebrochen werden.
                // Für den Moment wird createUrlDir aufgerufen, das intern einen Fehler werfen könnte, wenn crawlDir fehlt.
            }
            let sslKeyLogFileDir = await createUrlDir(clearUrl || "unknown_url_for_sslkeylogfile"); // Stellt sicher, dass das Verzeichnis existiert
            
            const sslKeyLogFilePath = path.join(sslKeyLogFileDir, "SSLKEYLOGFILE_" + (clearUrl || "default") + ".log");

            browser = spawn( 'node', [
                worker.crawl_script, 
                url, 
                worker.headless, 
                proxyHost, 
                worker.proxy_port, 
                userAgent, 
                waitingTime],
            { shell: true, env: {...process.env, SSLKEYLOGFILE: sslKeyLogFilePath}, 
            cwd: worker.script_path, stdio: "pipe" });

        }else{
            
            if(!dirCreated && crawlDir) { // dirCreated bezieht sich auf das Wissen, dass crawlDir (vom Scheduler) gesetzt wurde
                                        // und ggf. das Basisverzeichnis lokal erstellt wurde.
                // Das Haupt-Crawl-Verzeichnis (crawlDir) wird in worker.js gesetzt/erstellt.
                // Diese Funktion hier (`createDir`) ist nun primär für das Setzen des Flags `dirCreated` zuständig,
                // und ggf. für das Erstellen des *Unterverzeichnisses* für den Browser, falls `crawlDir` bekannt ist.
                // Siehe Anpassung von `createDir` weiter unten.
                // Eigentlich sollte worker.js createDir aufrufen und das Ergebnis an spawnScripts übergeben.
            } 

            let spawnArgs = [
                worker.crawl_script,
            ];
            if (worker.headless) {
                spawnArgs.push("--headless");
                console.log("SPAWNING HEADLESS BROWSER")
            }
            if (worker.enable_proxy){ // Proxy-Argumente für Browser bleiben, auch wenn Proxy extern gesteuert wird
                spawnArgs.push("--proxyhost", worker.proxy_host);
                spawnArgs.push("--proxyport", worker.proxy_port);
            }
            if (worker.stateless){
                spawnArgs.push("--reset");
            }
        
            // Pfad für Browser-spezifische Daten (OpenWPM, Puppeteer)
            // Dieser Pfad sollte relativ zum Haupt-Crawl-Verzeichnis (`crawlDir`) sein.
            let browserDataPathSuffix = fileformat === ".js" ? "puppeteer_Data" : "OpenWPMdata";
            if (!crawlDir) {
                console.error(colorize("ERROR:", "red") + " crawlDir not set. Cannot determine path for browser data.");
                // Fallback oder Fehlerbehandlung
                const fallbackBase = worker.script_path || "."; // Fallback, falls kein CrawlDir
                const uniqueTimestamp = new Date().getTime();
                spawnArgs.push("--crawldatapath", path.join(fallbackBase, browserDataPathSuffix + "_" + uniqueTimestamp));
            } else {
                 // Erstelle das Unterverzeichnis für Browser-Daten, falls es nicht existiert.
                const browserDataDir = path.join(crawlDir, browserDataPathSuffix);
                if (!fs.existsSync(browserDataDir)){
                    try { 
                        fs.mkdirSync(browserDataDir, { recursive: true }); 
                        console.log(colorize("INFO:", "gray") + " Created browser data directory: " + browserDataDir);
                    } catch (err) {
                         console.error(colorize("ERROR:", "red") + " Error creating browser data directory: " + browserDataDir, err);
                    }
                }
                spawnArgs.push("--crawldatapath", browserDataDir);
            }

            if (fileformat === ".js") {
                browser = spawn( 'node', spawnArgs,{
                    cwd: worker.script_path, 
                    stdio: "pipe" 
                });
            } else if (fileformat === ".py") {
                browser = spawn("conda run -n openwpm --no-capture-output python -u", spawnArgs, {
                    shell: true,
                    cwd: worker.script_path,
                    stdio: "pipe",
                    detached: true // Beibehalten für OpenWPM
                });
                console.log("spawned .py childprocess");
            } else {
                console.error("Fileformat not supported.");
                process.exit(); // Oder bessere Fehlerbehandlung
            }
            
            childExists = true;
            isCancelled = false;
        }

        // Listener für child process (Browser)
        browser.stdout.on("data", async (data) => {
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    console.log(colorize("BROWSER: ", "yellow") + line);
                }

                // BROWSER_FINISHED wird nun über ein internes Event signalisiert
                if (line.includes("BROWSER_FINISHED")) {
                    // browserFinished = true; // Nicht mehr global setzen
                    console.log(colorize("BROWSER: ", "yellow") + "Browser finished its tasks for the current URL.");
                    internalEventEmitter.emit("browser_finished_internal");
                    // Kein socket.emit("ITERATION_DONE") mehr hier
                }
                if (line.includes("browser_ready")) {
                    // socket.emit("browser_ready", worker.client_name); // Wird von worker.js gehandhabt, falls nötig
                    console.log(colorize("BROWSER: ", "yellow") + "Browser signals ready.");
                    internalEventEmitter.emit("browser_ready_internal", worker.client_name);
                }
                // URL_DONE wird nun über ein internes Event signalisiert
                if (line.includes("URL_DONE")) { 
                    console.log(colorize("BROWSER: ", "yellow") + "Browser signals URL_DONE for: " + visitedUrl);
                    internalEventEmitter.emit("url_done_internal", { clearUrl: visitedUrl });
                    // Kein socket.emit("URL_DONE") mehr hier an den Scheduler
                }
                if (line.includes("CRAWLER_ENV_INFO") && !dataGathered) {
                    dataGathered = true;
                    console.log(colorize("STATUS:", "green") + " Gathering crawl environment info");     
                    const dataString = data.toString();
                    console.log(colorize("BROWSER: ", "yellow") + dataString);
                    const jsonDataMatch = dataString.match(/CRAWLER_ENV_INFO (.+?)(?=\n|$)/);
                    if (jsonDataMatch) {
                        const jsonData = jsonDataMatch[1].trim();
                        try {
                            const parsedData = JSON.parse(jsonData);
                            crawlEnvInfo.gatherEnvironmentInfo(parsedData);
                        } catch (error) {
                            console.error(colorize("ERROR: ", "red") + 'Failed to parse JSON data:', error);
                        }
                    } else {
                        console.error(colorize("ERROR: ", "red") + 'No valid JSON data found after CRAWLER_ENV_INFO');
                    }
                }
            }
        });

        browser.stderr.on("data", (err) => {
            var err1 = err.toString();
            console.log(colorize("BROWSER: ", "yellow") + colorize("stderr Error: ", "red") + err1);
            // socket.emit("scripterror", err1);
        });

        browser.on("close", async (data) => {
            console.log(colorize("BROWSER: ", "yellow") + "Child process (Browser) closed");
            if( worker.enable_tcpdump && global.tcpdumpProcess){ // global.tcpdumpProcess muss in spawnDump gesetzt werden
                try {
                    console.log(colorize("STATUS:", "green") + " Killing tcpdump");
                    exkill(global.tcpdumpProcess.pid);
                    global.tcpdumpProcess = null; // Zurücksetzen
                } catch (error) {
                    console.log(colorize("ERROR:", "red") + " ERROR while killing tcpdump: ", error);
                }
            }  
            // Proxy wird durch ProxyManager in worker.js beendet.
            // Kein direkter Proxy-Kill mehr hier.
            childExists = false;
        });
        return module; // Bleibt für die Struktur, obwohl unklar, was `module` hier referenziert.
    },

    checkBrowserReady: function () {
        if (browser && browser.stdin) {
            browser.stdin.write("check_readiness\n");
        } else {
            console.error("Browser process is not available.");
        }
    },

    sendVisitUrlCommand: function (IterationConfig) {
        visitedUrl = IterationConfig.clearUrl; // `visitedUrl` für interne Logik (z.B. SSLKEYLOGFILE)
        if (browser && browser.stdin) {
            let jsonSignal = "visit_url" + JSON.stringify(IterationConfig) + "\n";
            browser.stdin.write(jsonSignal);
        } else {
            console.error("Browser process is not available.");
        }
    },
    
    cleanupProcesses: async function (exiting) { 
        if(exiting){
            console.log(colorize("STATUS:", "green") + "\nClosing browser child process before exiting..");
        }else{
            console.log(colorize("STATUS:", "green") + "\nCancelling browser child process because of timeout..");
        }
        isCancelled = true;

        if(!childExists && !exiting){
            console.log(colorize("INFO:", "gray") + " No browser child process existing")
            // Proxy wird separat in worker.js behandelt
            return Promise.resolve();
        } 

        console.log(colorize("STATUS:", "green") + " Killing browser child process");
        try {
            if (browser && browser.pid) {
                if (fileformat === ".js"){
                    try{ await browser.kill("SIGINT"); console.log(colorize("INFO:", "gray") + " Puppeteer process killed"); }
                    catch(error){ console.log(colorize("ERROR:", "red") + " Error while killing Puppeteer process:", error);}
                } else if (fileformat === ".py"){
                    try{ await process.kill(-browser.pid); console.log(colorize("INFO:", "gray") + " OpenWPM process killed"); }
                    catch(error){ console.log(colorize("ERROR:", "red") + " Error while killing OpenWPM process:", error);}
                }
            }
        } catch (error) {
            console.log(colorize("ERROR:", "red") + " Failed to kill browser child process", error);
        }
        childExists = false;
        console.log(colorize("INFO:", "gray") + " Browser child process killed."); 

        // Proxy-Cleanup wird in worker.js durch proxyManager.shutdown() gehandhabt.

        if(exiting && !baseConfig.persistent_proxy) { // Nur bei explizitem Exit und wenn kein persistenter Proxy läuft
                                          // (da proxyManager.shutdown() schon aufgerufen wurde/wird).
            // process.exit() wird in worker.js nach allen cleanup-Aktionen aufgerufen.
        }
        return Promise.resolve(); 
    },

    spawnDump: async function (clearUrl) { // TCPDump Logik
        var fileSaveDir = await createUrlDir(clearUrl); // Benötigt createUrlDir
        global.tcpdumpProcess = null; // Initialisieren

        return new Promise((resolve, reject) => {
            try {
                const dumpArgs = [
                    "'tcp port 80 or tcp port 443'", // Diese Anführungszeichen sind problematisch für spawn ohne shell:true
                    "-i", worker.tcpdump_interface || "any", // Konfigurierbares Interface, default 'any'
                    // '-s0', // Oft default oder nicht nötig
                    // '-A', // Kann sehr viel Output erzeugen
                    "-v",
                    "-w", path.join(fileSaveDir, replaceDotWithUnderscore(clearUrl) + '.pcapng')
                ];
                // Sicherere Ausführung ohne shell: true, wenn möglich
                // Für sudo und komplexe Argumente wie 'tcp port ...' ist shell:true oft einfacher,
                // aber birgt Sicherheitsrisiken.
                const command = worker.use_sudo_tcpdump ? "sudo" : "tcpdump";
                const finalArgs = worker.use_sudo_tcpdump ? ["tcpdump"].concat(dumpArgs.map(arg => arg.replace(/'/g, ""))) : dumpArgs.map(arg => arg.replace(/'/g, ""));
                 // Die Quotes um 'tcp port ...' müssen entfernt werden, wenn nicht shell: true verwendet wird,
                 // oder die Argumente müssen anders aufgeteilt werden.
                 // Für shell:true können die Quotes bleiben, aber die Argumente werden als ein String interpretiert.

                let tcpdumpInstance;
                if (worker.use_sudo_tcpdump || dumpArgs[0].includes(" ")) { // Wenn sudo oder Leerzeichen im ersten Arg -> shell
                    tcpdumpInstance = spawn(command, finalArgs, { shell: true, stdio: "pipe" });
                } else {
                    tcpdumpInstance = spawn(command, finalArgs, { stdio: "pipe" });
                }

                global.tcpdumpProcess = tcpdumpInstance; // Speichern für cleanup

            } catch (error) {
                console.log(colorize("ERROR:", "red") + " Failed to spawn tcpdump instance", error);
                reject(error);
                return;
            }
            console.log(colorize("TCPDUMP:", "blue") + " Spawned instance PID: ", global.tcpdumpProcess.pid);

            global.tcpdumpProcess.stderr.on("data", (err) => {
                console.log(colorize("TCPDUMP_ERR:", "red") + err.toString());
            });
            global.tcpdumpProcess.stdout.on("data", (data) => {
                console.log(colorize("TCPDUMP:", "blue") + data.toString());
            });
            global.tcpdumpProcess.on("close", (code) => {
                console.log(colorize("TCPDUMP:", "blue") + ` process closed with code ${code}.`);
                global.tcpdumpProcess = null;
            });
            resolve();
        });
    },

    // `createDir` wird jetzt vom worker.js aufgerufen, um das Haupt-Crawl-Verzeichnis (basierend auf crawlTimestamp)
    // zu setzen und an spawnCrawler zu übergeben (implizit über die globale `crawlDir` Variable).
    // Diese Funktion hier setzt nur noch das `dirCreated` Flag oder erstellt spezifische Unterverzeichnisse.
    // Es ist besser, wenn worker.js den Pfad explizit übergibt.
    // Für den Moment: `setGlobalCrawlDir` wird von worker.js aufgerufen.
    setGlobalCrawlDir: function(pathFromWorker) {
        crawlDir = pathFromWorker;
        if (fs.existsSync(crawlDir)) {
            dirCreated = true;
            console.log(colorize("STATUS:", "green") + ` Global crawl directory set by worker: ${crawlDir}`);
        } else {
            console.error(colorize("ERROR:", "red") + ` Global crawl directory from worker does not exist: ${crawlDir}`);
            dirCreated = false;
        }
    },
    colorize: colorize, // colorize Funktion exportieren
    colors: colors,      // colors Objekt exportieren
    internalEventEmitter: internalEventEmitter // EventEmitter exportieren
}

// Hilfsfunktionen, die früher für Proxy-HAR-Pfade verwendet wurden, aber jetzt allgemeiner sind:
// createUrlDir und replaceDotWithUnderscore bleiben hier, da sie auch für SSLKEYLOGFILE und tcpdump-Pfade benötigt werden.

// Create directory for each crawled URL (innerhalb des globalen crawlDir)
async function createUrlDir(clearUrl) {
    if (!crawlDir) {
        console.error(colorize("ERROR:", "red") + " Cannot create URL specific directory: global crawlDir not set.");
        // Fallback: Erstelle im aktuellen Verzeichnis oder wirf einen Fehler
        const fallbackDir = path.join(".", "url_data", replaceDotWithUnderscore(clearUrl || "default_url"));
        fs.mkdirSync(fallbackDir, { recursive: true });
        console.warn(colorize("WARNING:", "yellow") + " Created fallback URL directory: " + fallbackDir);
        return fallbackDir;
    }

    let urlSaveName = replaceDotWithUnderscore(clearUrl);
    urlSaveDir = path.join(crawlDir, urlSaveName); // Verwendet das globale crawlDir

    return new Promise((resolve, reject) => {
        fs.mkdir(urlSaveDir, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red") + " ERROR creating URL directory: " + urlSaveDir, err);
                reject(err);
            } else {
                console.log(colorize("INFO:", "gray") + " URL directory created/ensured: " + urlSaveDir);
                resolve(urlSaveDir);
            }
        });
    });
}

// Replace all characters that could be problematic in file paths
function replaceDotWithUnderscore(str) { // Wird von createUrlDir und spawnDump verwendet
    if (typeof str !== 'string') return 'default_filename';
    return str.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/__+/g, '_').replace(/^_|_$/g, '') || 'sanitized_filename';
}