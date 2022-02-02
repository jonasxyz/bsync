const {spawn} = require('child_process');
const path = require('path');

var tempUrl;
var childExists = false;

module.exports =
{
    spawnCrawler: function (crawl_script, url, client_name, script_path, headless, disable_proxy, proxy_host, proxy_port, userAgent, waitingTime) {

        tempUrl = url;
        fileformat = path.extname(crawl_script);

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
            if (data.toString().includes("browserready")) {

                socket.emit("browserready", client_name);
                console.log("Browser ready for visiting URL");

            }if (data.toString().includes("urldone")) { 

                socket.emit("urldone");
                console.log("URL done");
     

            }else console.log("stdout: " + data);
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

            if (disable_proxy == false) proxy.kill("SIGINT");
            console.log("Child process closed.");
            childExists = false;

        })

        return module;

    },
    
    killCrawler: function () { 
        
        if(childExists){
            if (fileformat === ".js") ls.kill("SIGINT");
            if (fileformat === ".py") process.kill(-ls.pid);

            childExists = false;
            console.log("Child process killed.");
        } 
        
    },

    spawnProxy: function (proxy_host, proxy_port, har_destination, script_location) {

        let urlSaveName = "/" + tempUrl.replace(/^https?\:\/\//i, "");
        proxy = spawn("mitmdump", ["--listen-host=" + proxy_host, "--listen-port=" + proxy_port, "--set=hardump=" + har_destination + urlSaveName, "-s /"+script_location+"/har_dump.py"]);

        console.log("proxy spawned")
        proxy.stderr.on("data", (err) => {

            console.log("proxy error: " + err.toString());

        })

    }
}
