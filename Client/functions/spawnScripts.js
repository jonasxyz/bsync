const {spawn} = require('child_process');
const path = require('path');
var exkill = require("tree-kill");
var fs = require('fs');
const axios = require('axios'); // for HTTP file upload
const FormData = require('form-data');

const crawlEnvInfo = require("./crawlEnvInfo.js");

var dataGathered = false;

const config = require("../config.js");
const worker = config.activeConfig.worker;
const baseConfig = config.activeConfig.base;

const fileformat = path.extname(worker.crawl_script);

var childExists = false;
var isCancelled = false;

var crawlDir;
var dirCreated = false;
var dirTimestamp;
var urlSaveDir;
var crawlDirTimestamp;

var browser;
var proxy;

let visitedUrl;

var harPathGlobal = null;

var browserFinished = false;
var proxyClosedPromise = null;

// Helper function for colored console output
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



module.exports =
{
    spawnCrawler: async function () {

        let { url, proxyHost, userAgent, waitingTime, clearUrl, headless } = config;

        
        // TODO Fix tcpdump especially for PoC        
        if(worker.enable_tcpdump){ // additionally setting the enviroment variable for saving sslkeylogfile

            //tcpdump = spawn( 'tcpdump', ["-s0", "-A 'tcp port 80 or tcp port 443'", "-w"+ worker.pcapng_destination + "pcapng/1.pcpapng"],{ shell: true, stdio: "pipe" });
            //tcpdump = spawn( 'tcpdump', ["-s0 -A 'tcp port 80 or tcp port 443' -w", worker.pcapng_destination + "1.pcapng"],{ shell: true, stdio: "pipe", detached: true });

            let urlSaveDir = await createUrlDir(clearUrl);

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
            
            if(!dirCreated) { // directory for OpenWPMs captured files
                crawlDir = await createDir();
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

                spawnArgs.push("--crawldatapath", crawlDir+"/puppeteer_Data");

                browser = spawn( 'node', spawnArgs,{ 
                    cwd: worker.script_path, 
                    stdio: "pipe" }); // todo check detached

                // console.log("SPAWN-STRING: ",'node', spawnArgs) // DEBUG
            }else if (fileformat === ".py") {

                spawnArgs.push("--crawldatapath", crawlDir+"/OpenWPMdata");

                browser = spawn("conda run -n openwpm --no-capture-output python -u", spawnArgs, {
                    shell: true,
                    cwd: worker.script_path,
                    stdio: "pipe",
                    detached: true
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
                }
            }

            if (data.toString().includes("BROWSER_FINISHED")) {  // TODO im not waiting for browser finished, espiavvaly for openwpm important
                browserFinished = true;

                console.log(colorize("BROWSER: ", "yellow") + "Browser finished, waiting for HAR file processing");

                // Start HAR file processing and wait for completion then send ITERATION_DONE
                try {
                    await this.handleHarFile();
                    console.log(colorize("STATUS:", "green") + " HAR file processing completed");
                    
                    console.log(colorize("SOCKETIO:", "cyan") + " Sending ITERATION_DONE");
                    await socket.emit("ITERATION_DONE");
                    console.log("\n---------------------------------------------------\n");
                } catch (error) {
                    console.error(colorize("ERROR: ", "red") + "Error processing HAR file:", error);

                    // TODO check what to do when raising an error
                    // Send ITERATION_DONE despite error
                    console.log(colorize("SOCKETIO:", "cyan") + " Sending ITERATION_DONE despite error");
                    await socket.emit("ITERATION_DONE");
                }


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

                //console.log("\n---------------------------------------------------\n")
                // browser.stdin.write("check_browser_ready\n");
                
                // Reset flags for next iteration
                browserFinished = false;
                proxyClosedPromise = null;

            }
            if (data.toString().includes("browser_ready")) {

                socket.emit("browser_ready", worker.client_name);
                console.log(colorize("SOCKETIO:", "cyan") + " Sending browser_ready");
                //console.log("Browser ready for visiting URL");

                // debug: Check har flows
                //this.getHarFlows1();

            }if (data.toString().includes("URL_DONE")) { 

                socket.emit("URL_DONE");
                console.log(colorize("SOCKETIO:", "cyan") + " Sending URL_DONE");     
                // writeSaveHar(); // debug^

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
                        gatherCrawlEnvInfo(parsedData); // Pass the parsed data to gatherCrawlEnvInfo
                        crawlEnvInfo.gatherEnvironmentInfo(parsedData); // Pass parsed data to the function
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

                try {
                    console.log(colorize("STATUS:", "green") + " Killing proxy");
                    exkill(proxy.pid);

                    //proxy.kill("SIGINT");
                    //process.kill(proxy.pid);
                    //proxy.stdin.write("shutdownproxy\n")
                } catch (error) {
                    console.log(colorize("ERROR:", "red") + " ERROR while killing proxy: ", proxy.pid, error);
                }    
          
            }else {

                console.log(colorize("BROWSER:", "yellow") + " Browser geschlossen") // Debug
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

    sendVisitUrlCommand: function (IterationConfig) {
        visitedUrl = IterationConfig.clearUrl;
        if (browser && browser.stdin) {

            let jsonSignal = "visit_url" + JSON.stringify(IterationConfig) + "\n";
            browser.stdin.write(jsonSignal);
        } else {
            console.error("Browser process is not available.");
        }
    },
    
    cleanupProcesses: async function (exiting) { 

        if(exiting){
            console.log(colorize("STATUS:", "green") + "\nClosing child processes before exiting..");
        }else{
            console.log(colorize("STATUS:", "green") + "\nCancelling child processes because of timeout..");
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
                    await browser.kill("SIGINT");
                    console.log(colorize("INFO:", "gray") + " Puppeteer process killed");
                }catch(error){
                    console.log(colorize("ERROR:", "red") + " Error while killing browser process:", error);
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

        //if(dirCreated == false) await createDir();

        // Create folder for every webite to save pcanp + sslkeylogfile / har file
        //if(!dirCreated) currDir = await createDir() + "/" + clearUrl + "/";


        //let currDir = dirName + "/" + clearUrl;
        //fs.mkdir(currDir, { recursive: true })
        //fs.mkdir(currDir, { recursive: true }, (err) => {
        //    if (err) { console.error(err); }
        //})

        //let urlSaveName = replaceDotWithUnderscore(clearUrl) +".pcapng";

        var fileSaveDir = await createUrlDir(clearUrl);


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
                    '-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng'],
       
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

            console.log(colorize("TCPDUMP:", "blue") + '-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng')
            console.log(colorize("TCPDUMP:", "blue") + ' sudo', 'tcpdump',
             'tcp port 80 or tcp port 443',
             '-i enp1s0',
             '-s0',
             '-A',
             '-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng')

            tcpdump = spawn('sudo', ['tcpdump',
             "'tcp port 80 or tcp port 443'",
             '-i enp1s0',
             '-s0',
             '-A',
             '-v',
             //'-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng'],
             '-w', '/home/user/Schreibtisch/dump/puppeteer/1_1/youtube_yay.pcapng'],
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

        // console.log("dircreated = ", dirCreated) // debug

        // if(!dirCreated) { // always create dir with crawler start
        //     crawlDir = await createDir();
        // } 

        //if(!dirCreated) await createDir();

        //console.log(clearUrl, "spawn clear URLL")

        //if(!dirCreated) currDir = await createDir() + "/" + clearUrl;

        //fs.mkdirSync(worker.pcapng_destination + "/1/" + clearUrl, { recursive: true })
        //let currDir = dirName + "/" + clearUrl;
        //fs.mkdir(currDir, { recursive: true })
        //fs.mkdir(currDir, { recursive: true }, (err) => {
         //   if (err) { console.error(err); }
        //})

        //'tcpdump', ["-s0", "-A 'tcp port 80 or tcp port 443'", "-w"+ worker.har_destination + "pcapng/1.pcpapng" ]

        //let urlSaveName = clearUrl.replace(/^https?\:\/\//i, "")+ ".har"; // todo check ob noch gebraucht
        //let urlSaveName = replaceDotWithUnderscore(clearUrl) +".har";

        if (worker.persistent_proxy == false) var fileSaveDir = await createUrlDir(clearUrl);
        
        //console.log("URLSAVENAME in spawmproxyist: --set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har")
        
        let mitmNewHarCapabilities = true;

        // Add check for existing proxy at the start
        if (proxy && proxy.pid) {
            console.log(colorize("MITMPROXY:", "magenta") + " Proxy already running with PID:", proxy.pid);
            return Promise.reject(new Error("Proxy already running"));
        }
        
        return new Promise((resolve, reject) => {

            // Extract the domain from the master_addr for not proxying requests to the master server
            let masterDomain = config.activeConfig.base.master_addr.replace(/^https?\:\/\//i, "");

            console.log(colorize("INFO:", "gray") + " MASTER DOMAIN: ", masterDomain);

            try{ 
        
                if(mitmNewHarCapabilities){
                    proxy = spawn("mitmdump", [
                        "--listen-host=" + worker.proxy_host,
                        "--listen-port=" + worker.proxy_port, 
                        "-s /home/user/Downloads/bsync/Client/proxyControllerSaveHar.py", // Load custom script to save HAR files and control proxy in runtime
                        "-v",
                        "--set=console_eventlog_verbosity=info",
                        "--set=termlog_verbosity=warn",
                        //"--set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har" // alt
                        // TODO brazuche ich das irgendwann?
                        //"--dumper_filter=" + config.activeConfig.base.master_addr + "*",
                        //"--ignore_hosts " + "\'" + config.activeConfig.base.master_addr + "\'",
                        //"--ignore-hosts=" + masterDomain + ",*." + masterDomain, // Dont log requests to master server 
                        //"--ignore-hosts=" + masterDomain, // Dont log requests to master server 
                        // Korrigierte Syntax für ignore-hosts mit exakter IP:Port-Kombination
                        //"--ignore-hosts=^" + masterDomain.replace(/\./g, "\\.").replace(/:/g, "\\:") + "$",

                        // oder + ",*." für regex

                        ],
                    {stdio: "pipe", shell: true});
                    // console.log("mitmdump", [
                    //     "--listen-host=" + worker.proxy_host,
                    //     "--listen-port=" + worker.proxy_port, 
                    //     //"-s "+ __dirname+"/har_dump.py", 
                    //     "--set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har"])
                }
                // else{
                //     proxy = spawn("mitmdump", [
                //         "--listen-host=" + worker.proxy_host,
                //         "--listen-port=" + worker.proxy_port, 
                //         "-s "+ __dirname+"/har_dump.py", 
                //         "--set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har"],
                //     {stdio: "pipe", shell: true});
                //     //  " -s "+worker.script_location+"shutdown.py"
                // }
                
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
                if (proxyOutput.includes("Error logged during startup")) {
                    console.log(colorize("MITMPROXY:", "magenta") + colorize(" Failed to start proxy", "red"));
                    reject(new Error("Another mitmproxy instance probably already running"));
                }

            })                
            proxy.on("close", async(data) => {


            })
            //let proxyOutput = ''; // todo hat einmal geklappt dass immer terminal out war, aber damit geht ipc schwerer

            proxy.stdout.on("data", (data) => {

                // proxyOutput += data.toString();

                const proxyOutput = data.toString();

                // Check for proxy ready message
                //if (proxyOutput.includes("HTTP(S) proxy listening at")) {
                if (proxyOutput.includes("IPC_PROXY_READY")) {
                    console.log(colorize("MITMPROXY:", "magenta") + " Proxy successfully started and ready");
                    resolve();
                }
                if (proxyOutput.includes("Error logged during startup")) {
                    console.log(colorize("MITMPROXY:", "magenta") + ": ");
                    reject();
                }
                if (proxyOutput.includes("IPC_PROXY_SHUTDOWN")) {
                    console.log(colorize("MITMPROXY:", "magenta") + " IPC channel proxy shutdown");
                }
                if (proxyOutput.includes("PROXY_SHUTDOWN_REQUESTED")) {
                    console.log(colorize("MITMPROXY:", "magenta") + " Proxy shutdown requested");
                }
                if (proxyOutput.includes("PROXY_HARDUMP_REQUESTED_HTTP")) {
                    console.log(colorize("MITMPROXY:", "magenta") + " Proxy hardump requested");
                }

                if (proxyOutput.startsWith("IPC_")) {
                    if (proxyOutput.includes("IPC_PROXY_READY")) {
                        console.log(colorize("MITMPROXY:", "magenta") + " IPC channel proxy ready");
                        resolve();
                    }
                    if (proxyOutput.includes("IPC_HAR_PATH_SET")) {
                    } 
                    else {
                        console.log(colorize("MITMPROXY:", "magenta") + " " + proxyOutput);
                    }
                }
  
                // Wait for proxy to be ready
                // if (data.toString().includes("HTTP(S) proxy listening at")) {
                //     //Promise.resolve().then(console.log("MITMPROXY: Proxy ready"));
                //     console.log("MITMPROXY: Proxy ready");
                //     resolve();
                // }

                //console.log("Debug: sent save.har");
                //proxy.stdin.write(":save.har"); // debug

                //console.log("proxy stdout: " + proxyOutput); // DEBUG Show proxy HTTP requests
            })

        // Funktion zum dynamischen Ändern des Speicherorts oder zum Speichern der HAR-Datei
        this.saveHar = function(newFileSaveDir) {
            console.log(colorize("MITMPROXY:", "magenta") + " Sending command to save HAR to:", newFileSaveDir);
            proxy.stdin.write(":save.har");
            proxy.stdin.write(":savehar " + newFileSaveDir + "\n");  // Command über stdin senden
        };

        // Beispielaufruf während der Laufzeit, um HAR-Datei zu speichern
        // setTimeout(() => {
        //     this.saveHar("/home/user/Desktop/test.har");  // HAR-Datei in neuem Pfad speichern
        // }, 1000);  // nach 5 Sekunden
        });
      
    },
    setHarDumpPath: async function (clearUrl) {

        if (!clearUrl) {
            console.log(colorize("ERROR:", "red") + " No URL provided for HAR dump path");
            return null;
        }
    
        // Create directory for the URL if it doesn't exist
        var fileSaveDir = await createUrlDir(clearUrl);
        
        console.log(colorize("STATUS:", "green") + " Setting hardump path");
        //console.log("STATUS: Setting hardump path to:", fileSaveDir);

        return new Promise((resolve, reject) => {

            const listener = (data) => {
                const proxyOutput = data.toString();
                if (proxyOutput.includes("IPC_HAR_PATH_SET")) {
                    console.log(colorize("MITMPROXY:", "magenta") + " HAR path set");
                    proxy.stdout.removeListener('data', listener); // Clean up listener
                    resolve();
                }
            };
            // Add temporary listener
            proxy.stdout.on('data', listener);

            const harPath = fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har";
            harPathGlobal = harPath;

            // Send harpath request to proxy per http request with X-Har-Path header
            axios.get('http://hardumppath.proxy.local/', {
                proxy: {
                    host: worker.proxy_host,
                    port: worker.proxy_port,
                    protocol: 'http'
                },
                headers: {
                    'X-Har-Path': harPath
                }
            }).catch(err => {
                // console.log("Failed to send harpath request:",); //err); DEBUG
            });

            // Add timeout
            setTimeout(() => {
                proxy.stdout.removeListener('data', listener); // Clean up listener
                reject(new Error('Timeout waiting for HAR path set confirmation'));
            }, 15000);

        // proxy.stdout.on("data", (data) => {
        //     const proxyOutput = data.toString();

        //     if (proxyOutput.startsWith("IPC_")) {
        //         if (proxyOutput.includes("IPC_HAR_PATH_SET")) {
        //             console.log("MITMPROXY: HAR path set");
        //             resolve();
        //         }
        //     }
        //     })
        });
        return harPath;


    },

    // Create directory to store generated files for current crawl
    createDir: async function (crawlTimestamp) {

        return new Promise((resolve, reject) => {

        //const dirName = `${dateString}_${timeString}`+worker.client_name;

        crawlDirTimestamp = crawlTimestamp;
        crawlDir = checkBackslash(worker.har_destination) + crawlTimestamp;
        //crawlDirOpenWPM = checkBackslash(worker.har_destination) + crawlDirTimestamp;

        fs.mkdir(crawlDir, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red"), err);
                reject(err);

            } else {
                dirCreated = true;
                console.log(colorize("STATUS:", "green") + ` Created crawl directory: ${crawlDir}`);
                resolve(crawlDir);
            }
        });
        })
    },

    handleHarFile: async function () {
        console.log(colorize("INFO:", "gray") + " Handling HAR file for URL:", visitedUrl);

        await this.setHarDumpPath(visitedUrl);
        await exportHar();
        await waitForHarFile(harPathGlobal);

        if (baseConfig.nfs_remote_filestorage) {
            await saveHarToNfs(visitedUrl);
        }
    },

    // Clear HAR flows // todo wurd noch nicht benutzt
    clearHarFlows: function () {
        if (!proxy && !proxy.stdin) return;
        console.log(colorize("MITMPROXY:", "magenta") + " Sending HTTP clearflows request to proxy");
        axios.get('http://clearflows.proxy.local/', {
            proxy: {
                host: worker.proxy_host,
                port: worker.proxy_port,
                protocol: 'http'
            }
        }).catch(err => { // error but its working
           // console.log("Failed to send clearflows request:",); //err); DEBUG
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
    colorize: function (text, color) {
        return colors.fg[color] + text + colors.reset;
    },
    colors: {
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
    },
}

// Testing for proxy ipc, not working yet todo
function writeSaveHar() { 
    if (proxy && proxy.stdin) {
        proxy.stdin.write(":save.har");
        console.log("Triggered save.har command");
    } else {
        console.error("Proxy process is not available.");
    }
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
async function saveHarToNfs(clearUrl) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(colorize("STATUS:", "green") + " Saving HAR to NFS server");
            let remoteUrlDir = await createRemoteUrlDir(clearUrl);
            let harFileName = replaceDotWithUnderscore(clearUrl) + ".har";

            // Move the HAR file to NFS
            //console.log("HAR path global: ", harPathGlobal); // debug
            //console.log("Remote URL dir: ", remoteUrlDir); // debug
            fs.copyFileSync(harPathGlobal, remoteUrlDir.toString() + "/" + harFileName);
            console.log(colorize("STATUS:", "green") + ` HAR file successfully saved to NFS at ${remoteUrlDir + "/" + harFileName}`);

            // Optionally delete the local HAR file
            if (baseConfig.delete_after_upload) {
                fs.unlinkSync(harPathGlobal);
                console.log(colorize("STATUS:", "green") + ` Local HAR file deleted: `, harPathGlobal);
            }

            resolve(colorize("STATUS:", "green") + ` HAR file successfully saved to ${remoteUrlDir}`);

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

// Graceful proxy shutdown via HTTP request
async function killProxy() {
    if (proxy && proxy.pid) {
        return new Promise((resolve, reject) => {
            try {
                // Wait for the proxy to actually close
                proxy.on("close", (data) => {
                    console.log(colorize("MITMPROXY:", "magenta") + " Proxy process closed"); // Seems proxy is not answering after shutdown command
                    resolve();
                });
                
                console.log(colorize("MITMPROXY:", "magenta") + " Sending shutdown command to proxy..."); // Debug log

                // Send HTTP request to trigger graceful shutdown
                axios.get('http://shutdown.proxy.local/', {
                    proxy: {
                        host: worker.proxy_host,
                        port: worker.proxy_port,
                        protocol: 'http'
                    }
                }).catch(err => {
                    //  Expecting this to fail as the proxy shuts down
                    console.log(colorize("ERROR:", "red") + " Failed to send graceful shutdown request:",);  // err);
                    //console.log("Failed to send graceful shutdown request:", err); // Debug
                    //console.log(proxy);

                });


                // Set a timeout in case the clean shutdown fails
                setTimeout(() => {
                    console.log(colorize("MITMPROXY:", "magenta") + colorize(" Proxy shutdown timeout - forcing kill", "red"));
                    exkill(proxy.pid);
                    //resolve();
                }, 4000); // 4 second timeout               
            } catch (error) {
                console.error(colorize("ERROR:", "red") + " Error while killing proxy process:", error);
                reject(error);
            }
        });
    }
    // old method not graceful
    //     try { 
    //         exkill(proxy.pid);
    //         console.log("Killing Proxy process");
    //     } catch (error) {
    //         console.error("Error while killing proxy process:", error);
    //     }
    //     return Promise.resolve();
    // }
}


// Create directory for each crawled URL
async function createUrlDir(clearUrl) {

    let urlSaveName = replaceDotWithUnderscore(clearUrl);

    urlSaveDir = crawlDir + "/" + urlSaveName + "/";

    return new Promise((resolve, reject) => {

        fs.mkdir(urlSaveDir, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red") + " ERROR creating URL directory:", err);
                reject(err);

            } else {
                //console.log("STATUS: Created directory: " + urlSaveDir);
                console.log(colorize("INFO:", "gray") + " URL directory created:", urlSaveDir);
                resolve(urlSaveDir);
            }
        });
    });
}

// Create directory for each crawled URL on NFS server
async function createRemoteUrlDir(clearUrl) {
    return new Promise((resolve, reject) => {
        let urlSaveName = replaceDotWithUnderscore(clearUrl);
        let remoteUrlDir = baseConfig.nfs_server_path + crawlDirTimestamp + "/" + urlSaveName + "/" + worker.client_name ;
        
        fs.mkdir(remoteUrlDir, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red") + " Error creating remote directory:", err);
                reject(err);
            } else {
                console.log(colorize("STATUS:", "green") + " Created remote directory: " + remoteUrlDir);
                resolve(remoteUrlDir);
            }
        });
    });
}

// Check if path ends with a backslash and add if not
function checkBackslash(str) {

    if (str.endsWith('/')) {
        return str;
    } else {
        return str + '/';
    }
}

// Replace dots with underscores in URL for file naming
function replaceDotWithUnderscore(str) {

    return str.replace(/\./g, '_');
}

function colorize(text, color) {
    return colors.fg[color] + text + colors.reset;
}

// moved to export for using in worker.js
// // Create directory to store generated files for current crawl
// async function createDir(crawlTimestamp) {

//     return new Promise((resolve, reject) => {

//     const now = new Date();
//     const dateString = now.toISOString().slice(0, 10);
//     const timeString = now.toTimeString().split(' ')[0].replace(/:/g, '-');

//     crawlDirTimestamp = `${dateString}_${timeString}`;
//     //const dirName = `${dateString}_${timeString}`+worker.client_name;

//     const crawlDir = checkBackslash(worker.har_destination) + crawlTimestamp;
//     //crawlDirOpenWPM = checkBackslash(worker.har_destination) + crawlDirTimestamp;

//     fs.mkdir(crawlDir, { recursive: true }, (err) => {
//         if (err) {
//             console.error(err);
//             reject(err);

//         } else {
//             dirCreated = true;
//             console.log(`STATUS: Created crawl directory: ${crawlDir}`);
//             resolve(crawlDir);
//         }
//     });
//     })
// }