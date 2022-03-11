const {spawn} = require('child_process');
const path = require('path');

var tempUrl;
var childExists = false;

module.exports =
{
    spawnCrawler: function (crawl_script, url, client_name, script_path, headless, disable_proxy, proxy_host, proxy_port, userAgent, waitingTime) {

        tempUrl = url;
        fileformat = path.extname(crawl_script);
        if(disable_proxy==true) proxy_host = "False"; 


        if (fileformat === ".js") {
            ls = spawn('node', [crawl_script, url, headless, proxy_host, proxy_port, userAgent, waitingTime], { cwd: script_path, stdio: "pipe", detached: true  });
            console.log("spawned .js childprocess");
            childExists = true;


        } else if (fileformat === ".py") {
            if (headless == true) {
                ls = spawn("conda run -n openwpm --no-capture-output python -u", [crawl_script, url, "headless", proxy_host, proxy_port, userAgent, waitingTime], { shell: true, cwd: script_path, stdio: "pipe", detached: true  });
            } else {
                ls = spawn("conda run -n openwpm --no-capture-output python -u", [crawl_script, url, "native", proxy_host, proxy_port, userAgent, waitingTime], { shell: true, cwd: script_path, stdio: "pipe", detached: true });
            }
            console.log("spawned .py childprocess");
            childExists = true;


        } else {
            console.error("Fileformat not supported.");
            process.exit();
        }



        // listener for child process
        ls.stdout.on("data", (data) => {
            console.log("browser stdout: " + data);
            if (data.toString().includes("browserready")) {

                socket.emit("browserready", client_name);
                //console.log("Browser ready for visiting URL");

            }if (data.toString().includes("urldone")) { 

                socket.emit("urldone");
                //console.log("URL done");
     

            }
        })

        ls.stderr.on("data", (err) => {
            var err1 = err.toString();
            console.log(err1);
            socket.emit("scripterror", err1);
        })
        ls.on("console.error();", (data) => {
            console.log("childprocess error: " + data);

        })
        ls.on("close", (data) => {

            if (disable_proxy == false){
                proxy.kill("SIGINT");
                console.log("Proxy closed");
            } 
            console.log("Child process closed");
            childExists = false;

        })

        return module;

    },
    
    killCrawler: function () { 
        
        if(childExists){
            if (fileformat === ".js") process.kill(-ls.pid); //ls.kill("SIGINT");
            if (fileformat === ".py") process.kill(-ls.pid);

            //if (disable_proxy == false) proxy.kill("SIGINT"); // proxyfix


            childExists = false;
            console.log("Child process killed.");
        } 
        
    },

    spawnProxy: function (proxy_host, proxy_port, har_destination, script_location, clearurl) {

        let urlSaveName = clearurl.replace(/^https?\:\/\//i, "")+ ".har";
        //console.log(urlSaveName) //debug
        proxy = spawn("mitmdump", ["--listen-host=" + proxy_host, "--listen-port=" + proxy_port, "--set=hardump=" + har_destination + urlSaveName, "-s "+script_location+"har_dump.py"]);

        // mitmdump --listen-host=localhost --listen-port=3031 --set=hardump=./url.har -s ./har_dump.py
        //proxy = spawn ("mitmdump", ["--listen-host="+host, "--listen-port="+port, "--set=hardump="+har_destination, "-s har_dump.py"]);

        console.log("mitm proxy spawned listening to " + proxy_host+ ":" + proxy_port);
        proxy.stderr.on("data", (err) => {

            console.log("proxy error: " + err.toString());

        })

    }
}