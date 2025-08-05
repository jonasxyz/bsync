const {spawn} = require('child_process');
const path = require('path');
var exkill = require("tree-kill");
var fs = require('fs');
const axios = require('axios'); // for HTTP file upload
const FormData = require('form-data');

const crawlEnvInfo = require("./crawlEnvInfo.js");
const fileSystemUtils = require("./fileSystemUtils.js"); // Added import for new utility functions
const { colorize, colors, prettySize, createDir, createUrlDir, createRemoteUrlDir, createBrowserProfileDir, createRemoteProfileDir, replaceDotWithUnderscore, getCrawlDir, getCrawlDirTimestamp, URLS_SUBDIR, PROFILES_SUBDIR, LOGS_SUBDIR, OPENWPM_DATA_SUBDIR, isDirCreated } = fileSystemUtils; // Destructure imported functions

var dataGathered = false;

// Config variables that will be initialized by the init function
let worker;
let baseConfig;
let fileformat;

// Debug option for proxy output - will be set in init
let PROXY_DEBUG_OUTPUT = false;

var childExists = false;
var isCancelled = false;

var timestampFirstRequest;

var browser;
var proxy;

let visitedUrl;
let visitedUrlIndex; // Added to store the current URL index
let totalUrls; // Added to store the total number of URLs for formatting

var harPathGlobal = null; // Stores the full local path to the HAR file

var browserFinished = false;
var proxyClosedPromise = null;
let urlVisitErrorOccurred = false; // Added to track URL visit errors

module.exports =
{
    init: function(passedConfig) {
        worker = passedConfig.activeConfig.worker;
        baseConfig = passedConfig.activeConfig.base;
        fileformat = path.extname(worker.crawl_script);
        PROXY_DEBUG_OUTPUT = baseConfig.proxy_debug_output || false;
        console.log(colorize("INFO:", "gray") + `spawnScripts initialized for worker: ${worker.client_name}`);
    },

    spawnCrawler: async function () {

        // TODO Fix tcpdump especially for PoC        
        if(worker.enable_tcpdump){ // additionally setting the enviroment variable for saving sslkeylogfile

            //tcpdump = spawn( 'tcpdump', ["-s0", "-A 'tcp port 80 or tcp port 443'", "-w"+ worker.pcapng_destination + "pcapng/1.pcpapng"],{ shell: true, stdio: "pipe" });
            //tcpdump = spawn( 'tcpdump', ["-s0 -A 'tcp port 80 or tcp port 443' -w", worker.pcapng_destination + "1.pcapng"],{ shell: true, stdio: "pipe", detached: true });

            let urlSaveDir = await fileSystemUtils.createUrlDir(clearUrl); // Use function from fileSystemUtils

            //console.log("URLSAVENAME in sslkeylogfile: " + urlSaveDir  +"sslkeylogfileworker.log");


            //if(!dirCreated) currDir = await createDir() + "/" + clearUrl;

            // neuste aber klappt herade nicht
            //tcpdump = spawn ( 'sudo tcpdump', ["-s0 -A 'tcp port 80 or tcp port 443' -w", worker.pcapng_destination + "1/" + clearUrl + "/url.pcapng"],{ shell: true, stdio: "pipe" })
            browser = spawn( 'node', [
                worker.crawl_script, 
                url, 
                worker.headless, 
                proxyHost, 
                worker.proxy_port, 
                userAgent, 
                waitingTime],
            { shell: true, env: {...process.env, SSLKEYLOGFILE: urlSaveDir  +"SSLKEYLOGFILE_" + clearUrl + ".log"}, 
            cwd: worker.script_path, stdio: "pipe" });

        }else{
            
            if(!fileSystemUtils.isDirCreated()) { // Use function from fileSystemUtils
                // crawlDir is set within createDir called by worker.js
                // No need to call createDir here directly anymore
            } 
            
            // Create browser profile directory
            let browserProfileDir;
            try {
                browserProfileDir = await fileSystemUtils.createBrowserProfileDir(); // Use function from fileSystemUtils
            } catch (error) {
                console.error(colorize("ERROR:", "red") + " Failed to create browser profile directory:", error);
                throw error;
            }
            
            //browser = spawn( 'node', [worker.crawl_script, url, worker.headless, proxyHost, worker.proxy_port, userAgent, waitingTime],
            //{ cwd: worker.script_path, stdio: "pipe" }); // todo check detached

            // new config 15:14 15-07-24
            let spawnArgs = [
                worker.crawl_script,
                //"--url" , config.url,
                //"--waitingtime" , config.waitingTime
            ];
            if (worker.headless) {
                spawnArgs.push("--headless");
                console.log("SPAWNING HEADLESS BROWSER")
            }
            // if (config.userAgent!="False"){
            //     spawnArgs.push("--useragent", config.userAgent) // todo why not worker.client_name);
            // }
            if (worker.enable_proxy){
                spawnArgs.push("--proxyhost", worker.proxy_host);
                spawnArgs.push("--proxyport", worker.proxy_port);
            }
            if (worker.stateless){
                spawnArgs.push("--reset");
            }
        
            if (fileformat === ".js") {

                spawnArgs.push("--crawldatapath", browserProfileDir);
                spawnArgs.push("--browserprofilepath", browserProfileDir);

                browser = spawn( 'node', spawnArgs,{ 
                    cwd: worker.script_path, 
                    stdio: "pipe" }); // todo check detached

                // console.log("SPAWN-STRING: ",'node', spawnArgs) // DEBUG
            }else if (fileformat === ".py") {

                const crawlDir = fileSystemUtils.getCrawlDir();
                const openWpmDataDir = path.join(crawlDir, OPENWPM_DATA_SUBDIR);
                const openWpmLogFile = path.join(crawlDir, LOGS_SUBDIR, `openwpm_internal_log_${worker.client_name}.log`);

                spawnArgs.push("--crawldatapath", openWpmDataDir);
                spawnArgs.push("--browserprofilepath", browserProfileDir);
                spawnArgs.push("--logfilepath", openWpmLogFile);

                browser = spawn("conda run -n openwpm --no-capture-output python -u", spawnArgs, {
                    shell: true,
                    cwd: worker.script_path,
                    stdio: "pipe",
                    //detached: true // Todo check detached
                });
                // console.log("SPAWN-STRING: ","conda run -n openwpm --no-capture-output python -u", spawnArgs) // DEBUG
                console.log("spawned .py childprocess");

            }else {

                console.error("Fileformat not supported.");
                process.exit();
            }
            
            //console.log("spawnArgs:", spawnArgs) // DEBUG
            childExists = true;
            isCancelled = false;
        }

        // Listener for child process
        browser.stdout.on("data", async (data) => {

            // Split output into individual lines and add prefix to each line
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                if (line.trim()) { // Leere Zeilen überspringen
                    console.log(colorize("BROWSER: ", "yellow") + line);

                    if (line.includes("URL_ERROR")) {
                        urlVisitErrorOccurred = true;
                        // URL_DONE will likely follow or might not, depending on script logic
                        // We primarily rely on BROWSER_FINISHED to proceed with HAR handling
                    }
                }
            }

            if (data.toString().includes("BROWSER_FINISHED")) {  // TODO im not waiting for browser finished, espiavvaly for openwpm important
                browserFinished = true;
                let processingError = null;
                let finalHarPath = null;

                console.log(colorize("BROWSER: ", "yellow") + "Browser finished, waiting for HAR file processing");

                // Start HAR file processing and wait for completion then send ITERATION_DONE
                try {
                    finalHarPath = await this.handleHarFile(); // Get the final HAR path
                    console.log(colorize("STATUS:", "green") + " HAR file processing completed");
                    
                    // console.log(colorize("SOCKETIO:", "cyan") + " Sending ITERATION_DONE"); // Old direct emit
                    // await socket.emit("ITERATION_DONE"); // Old direct emit
                } catch (error) {
                    console.error(colorize("ERROR: ", "red") + "Error processing HAR file:", error);
                    processingError = error.message ? error.message : "Unknown HAR processing error";
                    // Send ITERATION_DONE despite error, with error information
                    // console.log(colorize("SOCKETIO:", "cyan") + " Sending ITERATION_DONE despite error"); // Old direct emit
                    // await socket.emit("ITERATION_DONE"); // Old direct emit
                }

                const iterationData = {
                    harPath: finalHarPath, // This will be null if handleHarFile failed before path determination
                    urlVisitError: urlVisitErrorOccurred,
                    processingError: processingError
                };
                process.emit('scriptIterationDone', iterationData);
                console.log(colorize("INFO:", "gray") + " Emitted scriptIterationDone event with data: ", iterationData);
                console.log("\n---------------------------------------------------\n");


                // socket.emit("ITERATION_DONE"); 19.11
                // console.log("\x1b[36mSOCKETIO:\x1b[0m Sending ITERATION_DONE");  
                
                
                // console.log("\x1b[33mBROWSER: \x1b[0m" + "Browser finished, checking proxy status");
                // if (proxy && proxy.pid) {
                //     proxy.on("close", () => {
                //         console.log("Proxy closed, sending ITERATION_DONE");
                //         console.log("\x1b[36mSOCKETIO:\x1b[0m Sending ITERATION_DONE");
                //     });
                // } else {
                //     console.log("Proxy already closed, sending ITERATION_DONE");
                // }
                // await socket.emit("ITERATION_DONE");
                // browser.stdin.write("check_browser_ready\n");

                // Kill proxy if it is still running

            
                // Wait for both conditions
                // if (proxyClosedPromise) {
                //     await proxyClosedPromise;
                // }

                // export har hier machen irgendwelche vorteile?
                // vielleicht in zukunft hier den übertrag der dateien auf zentralen speicher machen
                
                // console.log("\x1b[36mSOCKETIO:\x1b[0m Sending ITERATION_DONE");
                // await socket.emit("ITERATION_DONE");
                
                // Reset flags for next iteration
                browserFinished = false;
                proxyClosedPromise = null;

            }
            if (data.toString().includes("browser_ready")) {

                // socket.emit("browser_ready", worker.client_name); // Old direct emit
                process.emit('scriptBrowserReadyRelay', worker.client_name);
                console.log(colorize("SOCKETIO:", "cyan") + " Sending browser_ready (via process event)");
                //console.log("Browser ready for visiting URL");

                // debug: Check har flows
                //this.getHarFlows1();

            }if (data.toString().includes("URL_DONE")) { 

                let timestampRequestToDone = new Date().toISOString();
                const elapsedSeconds = (new Date(timestampRequestToDone) - timestampFirstRequest) / 1000;
                console.log(colorize("TIMESTAMP:", "cyan") + " Timestamp of URL_DONE: " + timestampRequestToDone);
                console.log(colorize("TIMESTAMP:", "cyan") + " Elapsed time since first request: " + elapsedSeconds.toFixed(2) + " seconds");
                // socket.emit("URL_DONE"); // Old direct emit
                process.emit('scriptUrlDoneRelay');
                console.log(colorize("SOCKETIO:", "cyan") + " Sending URL_DONE (via process event)");     

                // await this.setHarDumpPath(visitedUrl);
                
                // await exportHar();

                // await waitForHarFile(harPathGlobal);  // todo eigentlich hier jetzt browser oder iteration finished
                // // vl warten fur browser finished und dann hier eine iteration_done senden

                // if (baseConfig.nfs_remote_filestorage) {
                //     await saveHarToNfs(visitedUrl);
                // }

                //this.handleHarFile();

                // Moved HAR file processing to browser_finished


                
            }
            if (data.toString().includes("CRAWLER_ENV_INFO") && !dataGathered) { // todo

                dataGathered = true;
                console.log(colorize("STATUS:", "green") + " Gathering crawl environment info");     

                // Extract the JSON data after "CRAWLER_ENV_INFO "
                const dataString = data.toString();
                console.log(colorize("BROWSER: ", "yellow") + dataString); // debug Log the raw data for inspection

                // Extract only the JSON part following "CRAWLER_ENV_INFO "
                // const jsonDataMatch = dataString.match(/CRAWLER_ENV_INFO (.+)/);
                // if (jsonDataMatch) {
                //     const jsonData = jsonDataMatch[1].trim(); // Get the matched JSON data portion
                //     try {
                //         const parsedData = JSON.parse(jsonData); // Parse JSON only
                //         crawlEnvInfo.gatherEnvironmentInfo(parsedData); // Pass parsed data to the function
                //     } catch (error) {
                //         console.error('Failed to parse JSON data:', error);
                //     }
                // }

                // Split the data string to extract the JSON data
                // const jsonData = dataString.split("CRAWLER_ENV_INFO ")[1].trim();
                // try {
                //     const parsedData = JSON.parse(jsonData);
                //     gatherCrawlEnvInfo(parsedData); // Pass the parsed data to gatherCrawlEnvInfo
                // crawlEnvInfo.gatherEnvironmentInfo(parsedData); // Pass parsed data to the function

                // } catch (error) {
                //     console.error('Failed to parse JSON data:', error);
                // }
                    // Extract only the JSON part following "CRAWLER_ENV_INFO "
                    
                const jsonDataMatch = dataString.match(/CRAWLER_ENV_INFO (.+?)(?=\n|$)/);
                if (jsonDataMatch) {
                    const jsonData = jsonDataMatch[1].trim(); // Get the matched JSON data portion
                    try {
                        const parsedData = JSON.parse(jsonData); // Parse JSON only
                        // Todo add crawlEnvInfo functionality
                        //gatherCrawlEnvInfo(parsedData); // Pass the parsed data to gatherCrawlEnvInfo 
                        //crawlEnvInfo.gatherEnvironmentInfo(parsedData); // Pass parsed data to the function
                    } catch (error) {
                        console.error(colorize("ERROR: ", "red") + 'Failed to parse JSON data:', error);
                    }
                } else {
                    console.error(colorize("ERROR: ", "red") + 'No valid JSON data found after CRAWLER_ENV_INFO');
                }
            }
            
        })

        browser.stderr.on("data", (err) => {
            var err1 = err.toString();
            console.log(err1);
            console.log(colorize("BROWSER: ", "yellow") + colorize("stderr Error: ", "red") + err1);

            socket.emit("scripterror", err1);
        })
        browser.on("console.error();", (data) => {
            console.log(colorize("BROWSER: ", "yellow") + colorize("console Error: ", "red") + data);

        })
        browser.on("close", async (data) => {

            console.log(colorize("BROWSER: ", "yellow") + "Child process closed");

            if( worker.enable_tcpdump){
                
                try {
                    console.log(colorize("STATUS:", "green") + " Killing tcpdump");
                    //exkill(tcpdump.pid);
                    //process.kill(tcpdump.pid);
                    tcpdump.kill('SIGINT');

                } catch (error) {
                    console.log(colorize("ERROR:", "red") + " ERROR while killing tcpdump: ", tcpdump.pid, error);
                }    

                console.log(tcpdump.pid)
            }  

            // todo brauch ich überhaupt noch? ungracefull shutdown
            if (worker.enable_proxy == true && isCancelled == false){ //if proxy is used proxy need to be closed to continue

                console.log(colorize("DEBUG:", "green") + "Legacy  -Killing proxy- function triggered");
                // try {
                //     console.log(colorize("STATUS:", "green") + " Killing proxy");
                //     exkill(proxy.pid);

                //     //proxy.kill("SIGINT");
                //     //process.kill(proxy.pid);
                //     //proxy.stdin.write("shutdownproxy\n")
                // } catch (error) {
                //     console.log(colorize("ERROR:", "red") + " ERROR while killing proxy: ", proxy.pid, error);
                // }    
          
            }else {

                console.log(colorize("BROWSER:", "yellow") + " Browser closed") // Debug
                console.log("isCanceled=",isCancelled)
                if(!isCancelled){ // todo notizen, browserfinished hier schlecht. weil mit stateful wird nicht mehr geschlossen
                    // socket.emit("browserfinished"); 03 nicht mehr hier
                    // console.log("\x1b[36mSOCKETIO:\x1b[0m Sending browserfinished");
                } 
            }
            childExists = false;

        })
        return module;
    },

    checkBrowserReady: function () {
        if (browser && browser.stdin) {
            browser.stdin.write("check_readiness\n");
        } else {
            console.error("Browser process is not available.");
        }
    },

    sendVisitUrlCommand: async function (IterationConfig) {
        visitedUrl = IterationConfig.clearUrl; // Store for handleHarFile and NFS export
        visitedUrlIndex = IterationConfig.urlIndex; // Store the URL index (1-based)
        totalUrls = IterationConfig.totalUrls; // Store total URLs for formatting
        timestampFirstRequest = new Date(); // Record time for duration calculation
        urlVisitErrorOccurred = false; // Reset error flag for new URL
        
        // Clear previous flows from proxy before visiting the new URL
        await this.clearHarFlows();
        
        if (browser && browser.stdin) {
            let jsonSignal = "visit_url" + JSON.stringify(IterationConfig) + "\n";
            browser.stdin.write(jsonSignal);
        } else {
            console.error("Browser process is not available.");
        }
    },
    
    cleanupProcesses: async function (exiting) { 

        if(exiting){
            console.log(colorize("STATUS:", "green") + "Closing child processes before exiting..");
        }else{
            console.log(colorize("STATUS:", "green") + "Cancelling child processes because of timeout..");
        }

        isCancelled = true;

        if(!childExists && !exiting){
            console.log(colorize("INFO:", "gray") + " No child processes existing")
            return Promise.resolve();
        } 

        console.log(colorize("STATUS:", "green") + " Killing child processes");
        try {
            //if (fileformat === ".js") process.kill(-browser.pid); //browser.kill("SIGINT");
            if (fileformat === ".js"){
                try{
                    // Send shutdown command to Firefox controller first
                    if (browser && browser.stdin) {
                        console.log(colorize("INFO:", "gray") + " Sending shutdown command to Firefox controller");
                        browser.stdin.write("shutdown\n");
                        
                        // Wait a bit for graceful shutdown
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                    
                    // If process is still running, force kill
                    if (browser && browser.pid) {
                        await browser.kill("SIGINT");
                        console.log(colorize("INFO:", "gray") + " Firefox controller process killed");
                    }
                }catch(error){
                    console.log(colorize("ERROR:", "red") + " Error while killing browser process:", error);
                    // Force kill if graceful shutdown failed
                    try {
                        if (browser && browser.pid) {
                            process.kill(browser.pid, 'SIGKILL');
                        }
                    } catch (forceKillError) {
                        console.log(colorize("ERROR:", "red") + " Error with force kill:", forceKillError);
                    }
                }
            }
            if (fileformat === ".py"){
                try{
                    await process.kill(-browser.pid);
                    console.log(colorize("INFO:", "gray") + " OpenWPM process killed");
                }catch(error){
                    console.log(colorize("ERROR:", "red") + " Error while killing browser process:", error);
                }
            }

            //if (worker.enable_proxy) exkill(proxy.pid); // raus 13:22 03-10-24 hat nicht geklappt
            // if (worker.enable_proxy) await proxy.kill("SIGINT"); // auch nicht
            // if (worker.enable_proxy) await process.kill(-proxy.pid); // nicht sicher ob das funktioniert

            // Only kill proxy if exiting
            if (worker.enable_proxy && exiting){
                await killProxy();
            }

            //if (worker.enable_proxy) proxy.kill("SIGINT"); // proxyfix
            //if (worker.enable_proxy) proxy.stdin.write("shutdownproxy\n");
        } catch (error) {
            console.log(colorize("ERROR:", "red") + " Failed to kill child processes");
            console.log(error);
            //reject(error);
        }

        childExists = false;
        console.log(colorize("INFO:", "gray") + " Child process killed."); 

        if(exiting) {
            console.log(colorize("STATUS:", "green") + " Exiting");
            process.exit();
        }

        return Promise.resolve(); 
    },

    spawnDump: async function (clearUrl) {
        // This function needs to use the new directory structure if it saves files.
        // Example: save to logs directory or a specific tcpdump directory within the crawlDir.
        // For now, it seems to use createUrlDir which might not be the intended new structure for dumps.
        // Assuming fileSaveDir should be a general log or dump path:
        const logDir = path.join(getCrawlDir(), LOGS_SUBDIR);
        await fs.promises.mkdir(logDir, { recursive: true }); // Ensure log directory exists
        // Use visitedUrlIndex for the dump file name if available, otherwise use clearUrl only
        const dumpFileNameBase = visitedUrlIndex !== undefined ? 
            `${fileSystemUtils.formatUrlIndex(visitedUrlIndex, totalUrls)}_${replaceDotWithUnderscore(clearUrl)}` : 
            replaceDotWithUnderscore(clearUrl);
        const dumpFilePath = path.join(logDir, `tcpdump_${dumpFileNameBase}.pcapng`);

        console.log(colorize("TCPDUMP:", "blue") + ` Starting tcpdump, saving to: ${dumpFilePath}`);

        return new Promise((resolve, reject) => {
            try {
                /* tcpdump = spawn('sudo tcpdump', [
                    //"'tcp port 80 or tcp port 443'",
                    '-i enp1s0',
                    //'-s0',
                    //'-A',
                    '-v',
                    //'-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng'],
                    '-w', '/home/user/Schreibtisch/dump/puppeteer/1_1/youtube_yay.pcapng'],
       
                { shell: true, stdio: "pipe" }); */

                tcpdump = spawn('sudo tcpdump', [
                    "'tcp port 80 or tcp port 443'",
                    '-i enp1s0',
                    //'-s0',
                    //'-A',
                    '-v',
                    //'-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng'],
                    '-w', dumpFilePath], // Use function from fileSystemUtils
       
                { shell: true, stdio: "pipe" });


            } catch (error) {

                console.log(colorize("ERROR:", "red") + " Failed to spawn tcpdump instance");
                console.log(error);
                reject(error);
            }

            console.log(colorize("TCPDUMP:", "blue") + " Spawned instance PID: ", tcpdump.pid);

            tcpdump.stderr.on("data", (err) => {
                var err1 = err.toString();
                console.log(err1);
            })
            tcpdump.stdout.on("data", (data) => {
                var data1 = data.toString();
                console.log(colorize("TCPDUMP:", "blue") + data1);
            })
            tcpdump.on("close", async (data) => {
                console.log(colorize("TCPDUMP:", "blue") + " kill durch browsers");
            })
            resolve();

        });


        try{ 
            //replaceDotWithUnderscore(clearUrl) + 
            /* tcpdump = spawn ( 'sudo tcpdump', [
                "-s0",
                "-A 'tcp port 80 or tcp port 443'",
                "-w " + fileSaveDir + replaceDotWithUnderscore(clearUrl) +".pcapng"],
            { shell: true, stdio: "pipe" }); */

            console.log(colorize("TCPDUMP:", "blue") + '-w', dumpFilePath) // Use function from fileSystemUtils
            console.log(colorize("TCPDUMP:", "blue") + ' sudo', 'tcpdump',
             'tcp port 80 or tcp port 443',
             '-i enp1s0',
             '-s0',
             '-A',
             '-v',
             //'-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng'],
             '-w', dumpFilePath) // Use function from fileSystemUtils

            tcpdump = spawn('sudo', ['tcpdump',
             "'tcp port 80 or tcp port 443'",
             '-i enp1s0',
             '-s0',
             '-A',
             '-v',
             //'-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng'],
             '-w', dumpFilePath],
            { shell: true, stdio: "pipe" }); 
            
           /*  tcpdump = spawn('sudo tcpdump', [
             "'tcp port 80 or tcp port 443'",
             '-i enp1s0',
             '-s0',
             '-A',
             '-v',
             //'-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng'],
             '-w', '/home/user/Schreibtisch/dump/puppeteer/1_1/youtube_yay.pcapng'],

            { shell: true, stdio: "pipe" }); */
            //console.log("fileSaveDir in dump: -w", fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".pcapng")

        }
        catch (e) {
            console.log(colorize("ERROR:", "red") + " Failed to spawn tcpdump instance");
            console.log(e);
            Promise.reject();
        }

        //console.log("TCPDUMP: Spawned instance PID: ", tcpdump.pid);

        Promise.resolve().then(console.log(colorize("TCPDUMP:", "blue") + " Spawned instance PID: ", tcpdump.pid));

        tcpdump.stderr.on("data", (err) => {
            var err1 = err.toString();
            console.log(err1);
        })
        tcpdump.stdout.on("data", (data) => {
            var data1 = data.toString();
            console.log(colorize("TCPDUMP:", "blue") + data1);
        })
        tcpdump.on("close", async (data) => {
            console.log(colorize("TCPDUMP:", "blue") + " kill durch browsers");
        })
    },

    spawnProxy: async function (clearUrl) {
        // The urlIndex is not directly used here as proxy is often persistent or its HAR path is set per URL.
        // However, if non-persistent proxy needed to create URL-indexed HARs directly on spawn, 
        // this function would need urlIndex too.
        if (proxy && proxy.pid) {
            console.log(colorize("MITMPROXY:", "magenta") + " Proxy already running with PID:", proxy.pid);
            return Promise.reject(new Error("Proxy already running"));
        }
        
        return new Promise((resolve, reject) => {

            // Extract the domain from the master_addr for not proxying requests to the master server
            let masterDomain = baseConfig.master_addr.replace(/^https?\:\/\//i, "");

            console.log(colorize("INFO:", "gray") + " MASTER DOMAIN: ", masterDomain);

            try{ 
        
                proxy = spawn("mitmdump", [
                    "--listen-host=" + worker.proxy_host,
                    "--listen-port=" + worker.proxy_port, 
                    // Load custom script to save HAR files and control proxy in runtime
                    "-s /home/user/Downloads/bsync/Client/proxy/proxyController.py",
                    "-v",
                    //"--set=console_eventlog_verbosity=info", 
                    "--set=console_eventlog_verbosity=warn", 
                    "--set=termlog_verbosity=warn",
                    //"--set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har" // alt
                    // TODO for bugfixing
                    //"--dumper_filter=" + config.activeConfig.base.master_addr + "*",
                    //"--ignore_hosts " + "\'" + config.activeConfig.base.master_addr + "\'",
                    //"--ignore-hosts=" + masterDomain + ",*." + masterDomain, // Dont log requests to master server 
                    //"--ignore-hosts=" + masterDomain, // Dont log requests to master server 
                    // Korrigierte Syntax für ignore-hosts mit exakter IP:Port-Kombination
                    //"--ignore-hosts=^" + masterDomain.replace(/\./g, "\\.").replace(/:/g, "\\:") + "$",

                    // oder + ",*." für regex

                    ], {
                        // stdio: ['ignore', 'ignore', 'pipe'], 
                        stdio: "pipe", 
                        shell: true,
                        env: process.env,  // Umgebungsvariablen weiterleiten
                        cwd: process.cwd() // Working directory setzen
                    });

                // console.log("mitmdump", [
                //     "--listen-host=" + worker.proxy_host,
                //     "--listen-port=" + worker.proxy_port, 
                //     //"-s "+ __dirname+"/har_dump.py", 
                //     "--set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har"])
            }
            catch (e) {
                console.log(colorize("ERROR:", "red") + " Failed to spawn mitmproxy instance");
                console.log(e);
                Promise.reject();
            }
    
            //Promise.resolve().then(console.log("MITMPROXY: Spawned instance PID: ", proxy.pid)); // moved to check if proxy is ready

            console.log(colorize("STATUS:", "green") + " Spawned Proxy instance PID:", proxy.pid, "listening to " + worker.proxy_host+ ":" + worker.proxy_port);

            proxy.stderr.on("data", async(err) => {

                const proxyOutput = err.toString();

                console.log(colorize("MITMPROXY:", "magenta") + colorize(" error: ", "red") + proxyOutput);
                console.log(colorize("MITMPROXY:", "magenta") + colorize(" errorNEU: ", "red") + err);
                if (proxyOutput.includes("Error logged during startup")) {
                    console.log(colorize("MITMPROXY:", "magenta") + colorize(" Failed to start proxy", "red"));
                    reject(new Error("Another mitmproxy instance probably already running"));
                }

            })                
            proxy.on("close", async(data) => {


            })
            //let proxyOutput = ''; // todo hat einmal geklappt dass immer terminal out war, aber damit geht ipc schwerer

            proxy.stdout.on("data", (data) => {
                const proxyOutput = data.toString();
                
                // Split output into lines to handle multiple messages
                const lines = proxyOutput.trim().split('\n');
                
                for (const line of lines) {
                    if (line.trim() === '') continue; // Skip empty lines
                    
                    // Check for new JSON IPC messages
                    if (line.startsWith("IPC_JSON:")) {
                        const jsonString = line.substring(9); // Remove "IPC_JSON:" prefix
                        const message = processProxyIpcMessage(jsonString);
                        
                        // Handle specific message types that need special actions
                        if (message && message.type === "proxy_ready") {
                            resolve();
                        }
                    }
                    // Handle legacy IPC messages for backward compatibility
                    else if (line.startsWith("IPC_")) {
                        if (line.includes("IPC_PROXY_READY")) {
                            console.log(colorize("MITMPROXY:", "magenta") + " IPC channel proxy ready (legacy)");
                            resolve();
                        } else if (line.includes("IPC_HAR_PATH_SET")) {
                            // This is handled in setHarDumpPath function
                        } else {
                            if (PROXY_DEBUG_OUTPUT) {
                                console.log(colorize("MITMPROXY:", "magenta") + " " + line);
                            }
                        }
                    }
                    // Handle other proxy messages
                    else if (line.includes("Error logged during startup")) {
                        console.log(colorize("MITMPROXY:", "magenta") + colorize(" Failed to start proxy", "red"));
                        reject(new Error("Another mitmproxy instance probably already running"));
                    }
                    else if (line.includes("PROXY_SHUTDOWN_REQUESTED")) {
                        console.log(colorize("MITMPROXY:", "magenta") + " Proxy shutdown requested (legacy)");
                    }
                    else if (line.includes("PROXY_HARDUMP_REQUESTED_HTTP")) {
                        console.log(colorize("MITMPROXY:", "magenta") + " Proxy hardump requested (legacy)");
                    }
                    // Show all other proxy output only if debug is enabled
                    else if (PROXY_DEBUG_OUTPUT) {
                        console.log(colorize("MITMPROXY:", "magenta") + " " + line);
                    }
                }
            })

        // TODO: remove this function
        // Funktion zum dynamischen Ändern des Speicherorts oder zum Speichern der HAR-Datei
        this.saveHar = function(newFileSaveDir) {
            console.log(colorize("MITMPROXY:", "magenta") + " Sending command to save HAR to:", newFileSaveDir);
            proxy.stdin.write(":save.har");
            proxy.stdin.write(":savehar " + newFileSaveDir + "\n");  // Command über stdin senden
        };

        });
      
    },
    setHarDumpPath: async function (clearUrl, urlIndex) {
        if (!proxy || !proxy.pid) {
            console.error(colorize("ERROR:", "red") + " Proxy is not running. Cannot set HAR dump path.");
            return null;
        }
        if (!clearUrl) {
            console.log(colorize("ERROR:", "red") + " No URL provided for HAR dump path");
            return null;
        }
        if (urlIndex === undefined) {
            console.error(colorize("ERROR:", "red") + " urlIndex is not set in setHarDumpPath. Cannot create HAR path.");
            return null;
        }
        
        const localUrlHarDir = await fileSystemUtils.createUrlDir(clearUrl, urlIndex, totalUrls); 
        if (!localUrlHarDir) {
            console.error(colorize("ERROR:", "red") + " Failed to create local URL HAR directory (localUrlHarDir is falsy). Cannot set HAR dump path.");
            return null;
        }
        const harFileName = `${fileSystemUtils.formatUrlIndex(urlIndex, totalUrls)}_${fileSystemUtils.replaceDotWithUnderscore(clearUrl)}.har`;
        const localHarPath = path.join(localUrlHarDir, harFileName);

        console.log(colorize("STATUS:", "green") + " Setting hardump path to: " + localHarPath);

        return new Promise((resolve, reject) => {

            const listener = (data) => {
                const proxyOutput = data.toString();
                const lines = proxyOutput.trim().split('\n');
                
                for (const line of lines) {
                    if (line.trim() === '') continue;
                    
                    if (line.startsWith("IPC_JSON:")) {
                        const jsonString = line.substring(9);
                        try {
                            const message = JSON.parse(jsonString);
                            if (message.type === "har_path_set") {
                                console.log(colorize("DEBUG:", "cyan") + ` [setHarDumpPath listener] Resolving with localHarPath: ${localHarPath}`);
                                console.log(colorize("MITMPROXY:", "magenta") + " HAR path set by proxy confirmation received for: " + localHarPath);
                                proxy.stdout.removeListener('data', listener);
                                harPathGlobal = localHarPath;
                                clearTimeout(proxySetHarDumpPathTimeoutId);
                                resolve(localHarPath);
                                return;
                            }
                        } catch (error) {
                            // Ignore JSON parse errors in listener
                        }
                    }
                    // legacy
                    else if (line.includes("IPC_HAR_PATH_SET")) {
                        console.log(colorize("DEBUG:", "cyan") + ` [setHarDumpPath listener legacy] Resolving with localHarPath: ${localHarPath}`);
                        console.log(colorize("MITMPROXY:", "magenta") + " HAR path set (legacy) by proxy confirmation received for: " + localHarPath);
                        proxy.stdout.removeListener('data', listener);
                        harPathGlobal = localHarPath;
                        clearTimeout(proxySetHarDumpPathTimeoutId);
                        resolve(localHarPath);
                        return;
                    }
                }
            };
            
            proxy.stdout.on('data', listener);

            var proxySetHarDumpPathTimeoutId = setTimeout(() => {
                proxy.stdout.removeListener('data', listener);
                console.error(colorize("ERROR:", "red") + ` Timeout waiting for HAR path set confirmation from proxy for: ${localHarPath}`);
                reject(new Error('Timeout waiting for HAR path set confirmation'));
            }, 3000);

            axios.get('http://hardumppath.proxy.local/', {
                proxy: {
                    host: worker.proxy_host,
                    port: worker.proxy_port,
                    protocol: 'http'
                },
                headers: {
                    'X-Har-Path': localHarPath
                }
            }).catch(err => {
                // console.log("Failed to send harpath request:",); //err); DEBUG
            });



        });
    },

    handleHarFile: async function () {
        console.log(colorize("INFO:", "gray") + " Handling HAR file for URL:", visitedUrl);

        const localHarPathFromAwait = await this.setHarDumpPath(visitedUrl, visitedUrlIndex);
        // console.log(colorize("DEBUG:", "cyan") + ` [handleHarFile] Value received from setHarDumpPath: ${localHarPathFromAwait}`);

        if (!localHarPathFromAwait) {
            throw new Error("Failed to set HAR dump path, harPath variable is empty.");
        }
        // Use localHarPathFromAwait instead of relying on harPathGlobal directly here for exportHar and waitForHarFile inputs if they need it.
        // However, exportHar and waitForHarFile(harPathGlobal) use harPathGlobal which is set inside setHarDumpPath's listener.
        // This is okay if setHarDumpPath resolves correctly.

        await exportHar(); // exportHar uses harPathGlobal implicitly via proxyController
        await waitForHarFile(harPathGlobal); // waitForHarFile explicitly uses harPathGlobal

        if (baseConfig.nfs_remote_filestorage) {
            try {
                const nfsPath = await saveHarToNfs(visitedUrl);
                return nfsPath;
            } catch (nfsError) {
                console.error(colorize("ERROR:", "red") + " Failed to save HAR to NFS, returning local path as fallback.", nfsError);
                return harPathGlobal; 
            }
        }
        return harPathGlobal; 
    },

    // Clear HAR flows
    clearHarFlows: function () {
        return new Promise((resolve, reject) => {
            if (!proxy || !proxy.pid) {
                console.error(colorize("ERROR:", "red") + " Proxy is not running. Cannot clear flows.");
                return reject(new Error("Proxy not running"));
            }

            const listener = (data) => {
                const proxyOutput = data.toString();
                const lines = proxyOutput.trim().split('\n');
                
                for (const line of lines) {
                    if (line.startsWith("IPC_JSON:")) {
                        const jsonString = line.substring(9);
                        try {
                            const message = JSON.parse(jsonString);
                            if (message.type === "flows_cleared") {
                                console.log(colorize("MITMPROXY:", "magenta") + ` Flows cleared confirmation received.`);
                                proxy.stdout.removeListener('data', listener);
                                clearTimeout(timeoutId);
                                resolve();
                                return;
                            }
                        } catch (error) { /* ignore JSON parse errors */ }
                    }
                }
            };
            
            proxy.stdout.on('data', listener);

            const timeoutId = setTimeout(() => {
                proxy.stdout.removeListener('data', listener);
                const errorMsg = "Timeout waiting for flows_cleared confirmation from proxy.";
                console.error(colorize("ERROR:", "red") + errorMsg);
                reject(new Error(errorMsg));
            }, 3000);

            console.log(colorize("MITMPROXY:", "magenta") + " Sending HTTP clearflows request to proxy");
            axios.get('http://clearflows.proxy.local/', {
                proxy: {
                    host: worker.proxy_host,
                    port: worker.proxy_port,
                    protocol: 'http'
                }
            }).catch(err => { 
                // This error is expected as the proxy doesn't send a proper HTTP response,
                // we are waiting for the IPC message instead.
            });
        });
    },
    // Get har flows // todo debug maybe remove
    getHarFlows1: async function () { // failed to send request, keine ipc antowrt
        if (!proxy && !proxy.stdin) return;
        console.log(colorize("MITMPROXY:", "magenta") + " Sending HTTP getharflows request to proxy");
        await axios.get('http://getharflows.proxy.local/', {
            proxy: {
                host: worker.proxy_host,
                port: worker.proxy_port,
                protocol: 'http'
            },
            timeout: 2000
        }).catch(err => {
        console.log(colorize("ERROR:", "red") + " Failed to send getharflows request:",); //err);
        });
        //} catch (err) {
        // Not catching error because responsing the http request with proxy kills the functionality
        //}
    },
    getHarFlows2: async function () { // schließt automatisch
        if (!proxy && !proxy.stdin) return;
        console.log(colorize("MITMPROXY:", "magenta") + " Sending HTTP getharflows request to proxy");
        try {
            await axios.get('http://getharflows.proxy.local/', {
                proxy: {
                    host: worker.proxy_host,
                    port: worker.proxy_port,
                    protocol: 'http'
                },
                timeout: 2000
            })
        } finally {
            console.log(colorize("MITMPROXY:", "magenta") + " send getharflows request successful");
        }
        // Not catching error because responsing the http request with proxy kills the functionality

    },
    createBrowserProfileDir: fileSystemUtils.createBrowserProfileDir, // Use function from fileSystemUtils
    colorize: fileSystemUtils.colorize, // Use function from fileSystemUtils
    colors: fileSystemUtils.colors, // Use function from fileSystemUtils
    saveProfilesToNfs 
}


// Send HTTP request to proxy to trigger hardump function
async function exportHar() {
    if (!proxy && !proxy.stdin) return;
    console.log("Sending HTTP hardump request to proxy");
    // Send HTTP request to trigger hardump test todo
    axios.get('http://harddump.proxy.local/', {
        proxy: {
            host: worker.proxy_host,
            port: worker.proxy_port,
            protocol: 'http'
        }
    }).catch(err => {
        // console.log("Failed to send hardump request:",); //err); DEBUG
    });
}

// Save exported HAR to NFS server
async function saveHarToNfs(clearUrlForNfs) {
    return new Promise(async (resolve, reject) => {
        try {
            if (visitedUrlIndex === undefined) {
                const errMsg = "visitedUrlIndex not set. Cannot save HAR to NFS.";
                console.error(colorize("ERROR:", "red") + errMsg);
                return reject(new Error(errMsg));
            }
            if (totalUrls === undefined || totalUrls === 0) {
                const errMsg = "totalUrls not set. Cannot save HAR to NFS with proper formatting.";
                console.error(colorize("ERROR:", "red") + errMsg);
                // Optionally, proceed with a default formatting or reject
                return reject(new Error(errMsg));
            }
            if (!harPathGlobal || !fs.existsSync(harPathGlobal)) {
                const errMsg = `Local HAR file for NFS export not found: ${harPathGlobal}`;
                console.error(colorize("ERROR:", "red") + errMsg);
                return reject(new Error(errMsg));
            }
            console.log(colorize("STATUS:", "green") + ` Starting HAR to NFS server export for: ${fileSystemUtils.formatUrlIndex(visitedUrlIndex, totalUrls)}_${clearUrlForNfs}`);
            
            // NFS structure: [NFS_Pfad]/[Crawl_Timestamp]/visited_urls/[urlIndex]_[sanitized_url]/[client_name]/
            const remoteNfsUrlDir = await fileSystemUtils.createRemoteUrlDir(clearUrlForNfs, visitedUrlIndex, totalUrls);
            const harFileName = path.basename(harPathGlobal); // Get filename from harPathGlobal
            const remoteNfsHarPath = path.join(remoteNfsUrlDir, harFileName);

            console.log(colorize("INFO:", "gray") + ` Copying HAR from ${harPathGlobal} to NFS ${remoteNfsHarPath}`);

            // Move the HAR file to NFS
            fs.copyFileSync(harPathGlobal, remoteNfsHarPath);
            console.log(colorize("STATUS:", "green") + ` HAR file successfully saved to NFS at ${remoteNfsHarPath}`);

            // Optionally delete the local HAR file
            if (baseConfig.delete_after_upload) {
                fs.unlinkSync(harPathGlobal);
                console.log(colorize("STATUS:", "green") + ` Local HAR file deleted: `, harPathGlobal);
            }

            resolve(remoteNfsHarPath); // Resolve with the NFS path

        } catch (error) {
            console.error(colorize("ERROR:", "red") + " Error while saving HAR to NFS:", error);
            reject(error);
        }
    });
}

// Wait for HAR file to be created with timeout
function waitForHarFile(harPath, timeout = 10000) {
    //console.log("\x1b[36mINFO:\x1b[0m Waiting for HAR file:", harPath);
    console.log(colorize("INFO:", "gray") + " Waiting for HAR file");

    
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const checkFile = () => {
            if (fs.existsSync(harPath)) {
                console.log(colorize("INFO:", "gray") + " HAR file found:", harPath);
                resolve(harPath);
                return;
            }
            
            if (Date.now() - startTime > timeout) {
                console.error(colorize("ERROR:", "red") + " Timeout waiting for HAR file:", harPath);
                reject(new Error("Timeout waiting for HAR file"));
                return;
            }
            
            setTimeout(checkFile, 100);
        };
        
        checkFile();
    });
}

// Trying to shutdown proxy gracefully via HTTP request then forcing kill if it fails
async function killProxy() {
    if (proxy && proxy.pid) {
        return new Promise((resolve, reject) => {
            let isResolved = false;
            
            const resolveOnce = () => {
                if (!isResolved) {
                    isResolved = true;
                    resolve();
                }
            };
            
            try {
                console.log(colorize("STATUS:", "green") + " Sending shutdown command to proxy..."); 

                // Wait for the proxy to actually close
                const closeHandler = (data) => {
                    console.log(colorize("STATUS:", "green") + " Proxy process closed gracefully");
                    proxy.removeListener("close", closeHandler); // Remove listener to prevent memory leaks
                    resolveOnce();
                };
                
                proxy.on("close", closeHandler);

                // Send HTTP request to trigger graceful shutdown
                axios.get('http://shutdown.proxy.local/', {
                    proxy: {
                        host: worker.proxy_host,
                        port: worker.proxy_port,
                        protocol: 'http'
                    },
                    timeout: 2000 // Add timeout to HTTP request
                }).catch(err => {
                    // Expecting this to fail as the proxy shuts down
                    console.log(colorize("INFO:", "gray") + " Graceful shutdown request completed (expected)");
                });

                // Set a timeout in case the clean shutdown fails
                setTimeout(() => {
                    if (!isResolved) {
                        console.log(colorize("MITMPROXY:", "magenta") + colorize(" Proxy shutdown timeout - forcing kill", "red"));
                        try {
                            exkill(proxy.pid, (error) => {
                                if (error) {
                                    console.log(colorize("ERROR:", "red") + " Error with exkill:", error);
                                } else {
                                    console.log(colorize("STATUS:", "green") + " Proxy force-killed successfully");
                                }
                                proxy.removeListener("close", closeHandler); // Clean up listener
                                resolveOnce();
                            });
                        } catch (killError) {
                            console.log(colorize("ERROR:", "red") + " Error during force kill:", killError);
                            proxy.removeListener("close", closeHandler);
                            resolveOnce();
                        }
                    }
                }, 4000); // 4 second timeout

                // Additional safety timeout to ensure we never hang indefinitely
                setTimeout(() => {
                    if (!isResolved) {
                        console.log(colorize("ERROR:", "red") + " Emergency timeout - force resolving proxy kill");
                        proxy.removeListener("close", closeHandler);
                        resolveOnce();
                    }
                }, 8000); // 8 second emergency timeout
                
            } catch (error) {
                console.error(colorize("ERROR:", "red") + " Error while killing proxy process:", error);
                resolveOnce(); // Resolve instead of reject to prevent hanging
            }
        });
    } else {
        console.log(colorize("INFO:", "gray") + " No proxy process to kill");
        return Promise.resolve();
    }
}

/**
 * Process JSON IPC messages from the proxy
 * @param {string} jsonString - The JSON string to parse
 */
function processProxyIpcMessage(jsonString) {
    try {
        const message = JSON.parse(jsonString);
        const { type, data, timestamp, debug } = message;

        // Log the message type with timestamp - REMOVED to avoid duplicate output
        // console.log(colorize("MITMPROXY:", "magenta") + ` [${type}]` + (debug ? ` ${debug}` : ""));

        switch (type) {
            case "proxy_ready":
                console.log(colorize("MITMPROXY:", "magenta") + " Proxy successfully started and ready");
                process.emit('proxyInitialized');
                break;

            case "proxy_loaded":
                console.log(colorize("MITMPROXY:", "magenta") + " Proxy addon loaded");
                break;

            case "har_export_started":
                console.log(colorize("MITMPROXY:", "magenta") + ` Starting HAR export with ${data.flows_count} flows`);
                break;

            case "har_export_completed":
                console.log(colorize("MITMPROXY:", "magenta") + ` HAR export completed: ${data.file_path} (${fileSystemUtils.prettySize(data.file_size)})`); // Use function from fileSystemUtils
                if (PROXY_DEBUG_OUTPUT) {
                    console.log(colorize("MITMPROXY:", "magenta") + ` Flows before/after clear: ${data.flows_before_clear}/${data.flows_after_clear}`);
                }
                break;

            case "hardump_requested":
                console.log(colorize("MITMPROXY:", "magenta") + ` HAR dump requested (${data.flows_count} flows)`);
                break;

            case "har_path_set":
                if (PROXY_DEBUG_OUTPUT) {
                    console.log(colorize("MITMPROXY:", "magenta") + ` HAR path set: ${data.har_path}`);
                }
                break;

            case "first_request_detected":
                console.log(colorize("MITMPROXY:", "magenta") + ` First request detected: ${data.method} ${data.url}`);
                //timestampFirstRequest = new Date();
                break;

            case "flows_cleared":
                if (PROXY_DEBUG_OUTPUT) {
                    console.log(colorize("MITMPROXY:", "magenta") + ` Flows cleared: ${data.flows_before_clear} -> ${data.flows_after_clear}`);
                }
                break;

            case "flows_cleared_config":
                if (PROXY_DEBUG_OUTPUT) {
                    console.log(colorize("MITMPROXY:", "magenta") + ` Flows cleared (${data.reason}): ${data.flows_before_clear} flows`);
                }
                break;

            case "har_flows_info":
                if (PROXY_DEBUG_OUTPUT) {
                    console.log(colorize("MITMPROXY:", "magenta") + ` Current HAR flows count: ${data.flows_count}`);
                }
                break;

            case "error":
                console.log(colorize("MITMPROXY:", "magenta") + colorize(` Error in ${data.operation}: ${data.error_message}`, "red"));
                break;

            case "debug":
                if (PROXY_DEBUG_OUTPUT) {
                    console.log(colorize("MITMPROXY:", "magenta") + colorize(` DEBUG: ${data.message}`, "gray"));
                }
                break;

            case "proxy_shutdown_requested":
                console.log(colorize("MITMPROXY:", "magenta") + " Proxy shutdown requested");
                if (PROXY_DEBUG_OUTPUT && data.flows_count > 0) {
                    console.log(colorize("MITMPROXY:", "magenta") + ` Clearing ${data.flows_count} flows before shutdown`);
                }
                break;

            default:
                console.log(colorize("MITMPROXY:", "magenta") + ` Unknown message type: ${type}`);
                if (PROXY_DEBUG_OUTPUT) {
                    console.log(colorize("MITMPROXY:", "magenta") + ` Data: ${JSON.stringify(data)}`);
                }
        }

        return message;
    } catch (error) {
        console.error(colorize("ERROR:", "red") + " Failed to parse proxy IPC message:", error);
        console.error(colorize("ERROR:", "red") + " Raw message:", jsonString);
        return null;
    }
}

/**
 * Recursively copies a directory.
 * @param {string} src The path to the source directory.
 * @param {string} dest The path to the destination directory.
 */
function copyDirRecursive(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(function(childItemName) {
            copyDirRecursive(path.join(src, childItemName),
                             path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

/**
 * Saves browser profiles to NFS.
 */
async function saveProfilesToNfs() {
    return new Promise(async (resolve, reject) => {
        if (!baseConfig.nfs_remote_filestorage) {
            console.log(colorize("INFO:", "gray") + " NFS remote filestorage is disabled. Skipping profile export to NFS.");
            return resolve("NFS profile export skipped.");
        }

        console.log(colorize("STATUS:", "green") + " Starting export of browser profiles to NFS server.");

        try {
            // Local source: [Haupt-Crawl-Ordner]/profiles/[client_name]/
            const localProfileDir = path.join(getCrawlDir(), PROFILES_SUBDIR, worker.client_name);
            // Remote destination: [NFS_Pfad]/[Crawl_Timestamp]/browser_profiles/[client_name]/
            const remoteNfsProfileDir = await fileSystemUtils.createRemoteProfileDir(); 

            if (!fs.existsSync(localProfileDir)) {
                console.warn(colorize("WARNING:", "yellow") + ` Local profile directory not found, skipping NFS export: ${localProfileDir}`);
                return resolve("Local profile directory not found.");
            }

            console.log(colorize("INFO:", "gray") + ` Copying from local: ${localProfileDir} to NFS: ${remoteNfsProfileDir}`);

            // Use custom recursive copy function
            copyDirRecursive(localProfileDir, remoteNfsProfileDir);
            console.log(colorize("STATUS:", "green") + ` Browser profile for ${worker.client_name} successfully copied to NFS: ${remoteNfsProfileDir}`);
                
            // Optionally delete the local profile directory after upload
            if (baseConfig.delete_after_upload) {
                try {
                    fs.rmSync(localProfileDir, { recursive: true, force: true });
                    console.log(colorize("STATUS:", "green") + ` Local profile directory deleted: ${localProfileDir}`);
                } catch (rmErr) {
                    console.error(colorize("ERROR:", "red") + ` Error deleting local profile directory ${localProfileDir}:`, rmErr);
                }
            }
            resolve(`Profile for ${worker.client_name} copied to NFS.`);

        } catch (error) {
            console.error(colorize("ERROR:", "red") + " Error during profile export to NFS:", error);
            reject(error);
        }
    });
}