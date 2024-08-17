const {spawn} = require('child_process');
const path = require('path');
var exkill = require("tree-kill");
var fs = require('fs');

const config = require("../config.js");
const worker = config.activeConfig.worker;


var childExists = false;
var isCancelled = false;

var crawlDir;
var dirCreated = false;
var dirTimestamp;
var urlSaveDir

module.exports =
{
    spawnCrawler: async function (config) {

        let { url, proxyHost, userAgent, waitingTime, clearUrl, headless } = config;
        fileformat = path.extname(worker.crawl_script);

        

        //if(worker.enable_proxy==false) proxyHost = "False"; 

    

                //'tcpdump', ["-s0", "-A 'tcp port 80 or tcp port 443'", "-w"+ worker.pcapng_destination + "pcapng/1.pcpapng" ]

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

            //browser = spawn( 'node', [worker.crawl_script, url, worker.headless, proxyHost, worker.proxy_port, userAgent, waitingTime],
            //{ cwd: worker.script_path, stdio: "pipe" }); // todo check detached

            // new config 15:14 15-07-24
            let spawnArgs = [
                worker.crawl_script,
                "--url" , config.url,
                "--waitingtime" , config.waitingTime
            ];
            console.log("PUPPETEER URL "+url)
            if (worker.headless) {
                spawnArgs.push("--headless");
                console.log("SPAWNING HEADLESS BROWSER")
            }
            if (config.userAgent!="False"){
                spawnArgs.push("--useragent", config.userAgent) // todo why not worker.client_name);
            }
            if (worker.enable_proxy){
                spawnArgs.push("--proxyhost", worker.proxy_host);
                spawnArgs.push("--proxyport", worker.proxy_port);
            }
        
        
            if (fileformat === ".js") {

                browser = spawn( 'node', spawnArgs,{ 
                    cwd: worker.script_path, 
                    stdio: "pipe" }); // todo check detached

                // console.log("SPAWN-STRING: ",'node', spawnArgs) // DEBUG
            }else if (fileformat === ".py") {

                if(!dirCreated) { // directory for OpenWPMs captured files
                    crawlDir = await createDir();
                } 
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
            
        
            childExists = true;
            isCancelled = false;
        }

        // listener for child process
        browser.stdout.on("data", (data) => {

            console.log("\x1b[33mBROWSER: \x1b[0m" + data);


            if (data.toString().includes("browserready")) {

                socket.emit("browserready", worker.client_name);
                console.log("\x1b[36mSOCKETIO:\x1b[0m Sending browserready");
                //console.log("Browser ready for visiting URL");

            }if (data.toString().includes("urldone")) { 

                socket.emit("urlcrawled");
                console.log("\x1b[36mSOCKETIO:\x1b[0m Sending urlcrawled");
                //console.log("URL done");
     
            }
        })

        

        browser.stderr.on("data", (err) => {
            var err1 = err.toString();
            console.log(err1);
            console.log("\x1b[33mBROWSER: \x1b[0m" + "stderr Error: " + err1);

            socket.emit("scripterror", err1);
        })
        browser.on("console.error();", (data) => {
            console.log("\x1b[33mBROWSER: \x1b[0m" + "console Error: " + data);

        })
        browser.on("close", async (data) => {

            console.log("\x1b[33mBROWSER: \x1b[0m" + "Child process closed");

            if( worker.enable_tcpdump){
                
                try {
                    console.log("STATUS: Killing tcpdump");
                    //exkill(tcpdump.pid);
                    //process.kill(tcpdump.pid);
                    tcpdump.kill('SIGINT');

                } catch (error) {
                    console.log("ERROR while killing tcpdump: ", tcpdump.pid, error);
                }    

                console.log(tcpdump.pid)
                
            }  

            if (worker.enable_proxy == true && isCancelled == false){ //if proxy is used proxy need to be closed to continue

                try {
                    console.log("STATUS: Killing proxy");
                    exkill(proxy.pid);

                    //proxy.kill("SIGINT");
                    //process.kill(proxy.pid);
                    //proxy.stdin.write("shutdownproxy\n")
                } catch (error) {
                    console.log("ERROR while killing proxy: ", proxy.pid, error);
                }    
          
    
            }else {

                console.log("else close kommt")
                console.log("isCanceled=",isCancelled)
                if(!isCancelled){
                    socket.emit("browserfinished");
                    console.log("\x1b[36mSOCKETIO:\x1b[0m Sending browserfinished");
                } 

            }
            childExists = false;

        })

        return module;

    },
    
    killCrawler: async function () { 

        isCancelled = true;

        if(!childExists){
            console.log("No child processes existing")
            return Promise.resolve();
        } 

        console.log("Killing child processes");
        try {
            //if (fileformat === ".js") process.kill(-browser.pid); //browser.kill("SIGINT");
            if (fileformat === ".js") await browser.kill("SIGINT");
            if (fileformat === ".py") await process.kill(-browser.pid); //vmedit add await

            if (worker.enable_proxy) exkill(proxy.pid);
            //if (worker.enable_proxy) proxy.kill("SIGINT");


            //if (worker.enable_proxy) proxy.kill("SIGINT"); // proxyfix
            //if (worker.enable_proxy) proxy.stdin.write("shutdownproxy\n");
        } catch (error) {
            console.log("Failed to kill child processes");
            console.log(error);
            //reject(error);
        }

        

        childExists = false;
        console.log("Child process killed."); 
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
                    //'-v',
                    '-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng'],
                    //'-w', '/home/user/Schreibtisch/dump/puppeteer/1_1/youtube_yay.pcapng'],
       
                { shell: true, stdio: "pipe" });


            } catch (error) {

                console.log("Failed to spawn tcpdump instance");
                console.log(error);
                reject(error);
            }

            console.log("TCPDUMP: Spawned instance PID: ", tcpdump.pid);

            tcpdump.stderr.on("data", (err) => {
                var err1 = err.toString();
                console.log(err1);
            })
            tcpdump.stdout.on("data", (data) => {
                var data1 = data.toString();
                console.log("TCPDUMP:", data1);
            })
            tcpdump.on("close", async (data) => {
                console.log("TCPDUMP kill durch browsers");
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

            console.log('-w', fileSaveDir + replaceDotWithUnderscore(clearUrl) +'.pcapng')
            console.log('sudo', 'tcpdump',
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
            console.log("Failed to spawn tcpdump instance");
            console.log(e);
            Promise.reject();
        }

        //console.log("TCPDUMP: Spawned instance PID: ", tcpdump.pid);

        Promise.resolve().then(console.log("TCPDUMP: Spawned instance PID: ", tcpdump.pid));

        tcpdump.stderr.on("data", (err) => {
            var err1 = err.toString();
            console.log(err1);
        })
        tcpdump.stdout.on("data", (data) => {
            var data1 = data.toString();
            console.log("TCPDUMP:", data1);
        })
        tcpdump.on("close", async (data) => {
            console.log("TCPDUMP kill durch browsers");
        })
    },

    spawnProxy: async function (clearUrl) {

        console.log("dircreated = ", dirCreated)

        if(!dirCreated) {
            crawlDir = await createDir();
        } 

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

        var fileSaveDir = await createUrlDir(clearUrl);
        
        //console.log("URLSAVENAME in spawmproxyist: --set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har")
        
        let mitmNewHarCapabilities = true;

        try{ 
    
            if(mitmNewHarCapabilities){
                proxy = spawn("mitmdump", [
                    "--listen-host=" + worker.proxy_host,
                    "--listen-port=" + worker.proxy_port, 
                    //"-s "+ __dirname+"/har_dump.py", 
                    "--set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har"],
                {stdio: "pipe", shell: true});
                console.log("mitmdump", [
                    "--listen-host=" + worker.proxy_host,
                    "--listen-port=" + worker.proxy_port, 
                    //"-s "+ __dirname+"/har_dump.py", 
                    "--set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har"])
            }else{
                proxy = spawn("mitmdump", [
                    "--listen-host=" + worker.proxy_host,
                    "--listen-port=" + worker.proxy_port, 
                    "-s "+ __dirname+"/har_dump.py", 
                    "--set=hardump=" + fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har"],
                {stdio: "pipe", shell: true});
                //  " -s "+worker.script_location+"shutdown.py"
            }
            
        }
        catch (e) {
            console.log("Failed to spawn mitmproxy instance");
            console.log(e);
            Promise.reject();
        }
   
        Promise.resolve().then(console.log("MITMPROXY: Spawned instance PID: ", proxy.pid));

        console.log("MITMPROXY: Proxy listening to " + worker.proxy_host+ ":" + worker.proxy_port);

        proxy.stderr.on("data", (err) => {

            console.log("proxy error: " + err.toString());

        })                
        proxy.on("close", async(data) => {

            console.log("Proxy closed");

            if(!isCancelled){
                socket.emit("browserfinished");
                console.log("\x1b[36mSOCKETIO:\x1b[0m Sending browserfinished");

                if (fs.existsSync(fileSaveDir + replaceDotWithUnderscore(clearUrl) + ".har")) {
                    console.log("Proxy generated HAR file in directory:", fileSaveDir);
                } else {
                    console.log("Proxy failed to generate file in directory:", fileSaveDir);
                }
            } 
        })
        proxy.stdout.on("data", (data) => {

            // console.log("proxy stdout: " + data); // DEBUG Show proxy HTTP requests
        })
    }
}

// Create directory to store generated files for current crawl
async function createDir() {

    return new Promise((resolve, reject) => {

        const now = new Date();
        const dateString = now.toISOString().slice(0, 10);
        const timeString = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        const dirName = `${dateString}_${timeString}`+worker.client_name;

        const crawlDir = checkBackslash(worker.har_destination) + dirName;
        //crawlDirOpenWPM = checkBackslash(worker.har_destination) + dirName;

        
        fs.mkdir(crawlDir, { recursive: true }, (err) => {
            if (err) {
                console.error(err);
                reject(err);

            } else {
                dirCreated = true;
                console.log(`STATUS: Created crawl directory: ${crawlDir}`);
                resolve(crawlDir);
            }
        });

    })
}

async function createUrlDir(clearUrl) {

    let urlSaveName = replaceDotWithUnderscore(clearUrl);

    var urlSaveDir = crawlDir + "/" + urlSaveName + "/";

    return new Promise((resolve, reject) => {

        fs.mkdir(urlSaveDir, { recursive: true }, (err) => {
            if (err) {
                console.error(err);
                reject(err);

            } else {
                //console.log("STATUS: Created directory: " + urlSaveDir);
                resolve(urlSaveDir);
            }
        });
    });
}


function checkBackslash(str) {

    if (str.endsWith('/')) {
        return str;
    } else {
        return str + '/';
    }
}

function replaceDotWithUnderscore(str) {

    return str.replace(/\./g, '_');
}