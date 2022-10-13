const {spawn} = require('child_process');
const path = require('path');
var exkill = require("tree-kill");

const config = require("../config.js");
const worker = config.worker;



var tempUrl;
var childExists = false;
var isCancelled = false;


module.exports =
{
    spawnCrawler: async function (url, proxyHost, userAgent, waitingTime) {

        tempUrl = url;
        fileformat = path.extname(worker.crawl_script);

        if(worker.enable_proxy==false) proxyHost = "False"; 

        if (fileformat === ".js") {

            browser = spawn('node', [worker.crawl_script, url, worker.headless, proxyHost, worker.proxy_port, userAgent, waitingTime],
             { cwd: worker.script_path, stdio: "pipe" }); // todo check detached

            console.log("spawned .js childprocess");
            childExists = true;
            isCancelled = false;


        } else if (fileformat === ".py") {
            if (worker.headless == true) {

                browser = spawn("conda run -n openwpm --no-capture-output python -u", [worker.crawl_script, url, "headless", proxyHost, worker.proxy_port, userAgent, waitingTime],
                 { shell: true, cwd: worker.script_path, stdio: "pipe", detached: true  });

            } else {

                browser = spawn("conda run -n openwpm --no-capture-output python -u", [worker.crawl_script, url, "native", proxyHost, worker.proxy_port, userAgent, waitingTime],
                 { shell: true, cwd: worker.script_path, stdio: "pipe", detached: true });

            }
            console.log("spawned .py childprocess");
            childExists = true;
            isCancelled = false;


        } else {

            console.error("Fileformat not supported.");
            process.exit();
        }



        // listener for child process
        browser.stdout.on("data", (data) => {

            console.log("browser stdout: " + data);

            if (data.toString().includes("browserready")) {

                socket.emit("browserready", worker.client_name);
                //console.log("Browser ready for visiting URL");

            }if (data.toString().includes("urldone")) { 

                socket.emit("urlcrawled");
                //console.log("URL done");
     
            }
        })

        browser.stderr.on("data", (err) => {
            var err1 = err.toString();
            console.log(err1);
            socket.emit("scripterror", err1);
        })
        browser.on("console.error();", (data) => {
            console.log("childprocess error: " + data);

        })
        browser.on("close", async(data) => {

            console.log("Crawler child process closed");

            if (worker.enable_proxy == true && isCancelled == false){
                //proxy.kill("SIGINT");
                //process.kill(proxy.pid);
                //console.log("Proxy should close"); //debug
                exkill(proxy.pid);
                //proxy.stdin.write("shutdownproxy\n");                
    
            }else {

                if(!isCancelled) socket.emit("browserfinished");
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
        //if (fileformat === ".js") process.kill(-browser.pid); //browser.kill("SIGINT");
        if (fileformat === ".js") browser.kill("SIGINT");
        if (fileformat === ".py") process.kill(-browser.pid);

        if (worker.enable_proxy) exkill(proxy.pid);
        //if (worker.enable_proxy) proxy.kill("SIGINT");


        //if (worker.enable_proxy) proxy.kill("SIGINT"); // proxyfix
        //if (worker.enable_proxy) proxy.stdin.write("shutdownproxy\n");

        childExists = false;
        console.log("Child process killed."); 
        return Promise.resolve();       
        
    },

    spawnProxy: async function (clearurl) {

        let urlSaveName = clearurl.replace(/^https?\:\/\//i, "")+ ".har";

        try{ 
            proxy = spawn("mitmdump", ["--listen-host=" + worker.proxy_host, "--listen-port=" + worker.proxy_port, "-s "+ __dirname+"/har_dump.py", "--set=hardump=" + worker.har_destination + urlSaveName ],
             { stdio: "pipe", shell: true});
            //  " -s "+worker.script_location+"shutdown.py"
        }
        catch (e) {
            console.log("Failed to spawn mitmproxy instance");
            console.log(e);
            Promise.reject();
        }
   
        Promise.resolve().then(console.log("mitm proxy spawned listening to " + worker.proxy_host+ ":" + worker.proxy_port));

        proxy.stderr.on("data", (err) => {

            console.log("proxy error: " + err.toString());

        })                
        proxy.on("close", async(data) => {

            console.log("Proxy closed");
            if(!isCancelled) socket.emit("browserfinished");
        })
        //proxy.stdout.on("data", (data) => {
            //console.log("proxy stdout: " + data);
        //}
    }
}