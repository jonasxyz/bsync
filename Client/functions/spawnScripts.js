const {spawn} = require('child_process');
const path = require('path');

var tempUrl;
var isCancelled = false;

module.exports =
{
    spawnCrawler: function (crawl_script, url, client_name, script_path, headless, disable_proxy, proxy_host, proxy_port, userAgent, waitingTime) {

        isCancelled = false;
        tempUrl = url;
        fileformat = path.extname(crawl_script);

        if (fileformat === ".js") {
            ls = spawn('node', [crawl_script, url, headless, proxy_host, proxy_port, userAgent, waitingTime], { cwd: script_path, stdio: ["pipe"] });
            console.log("spawned .js childprocess");
            //console.log(sId);



        } else if (fileformat === ".py") {
            if (headless == true) {
                ls = spawn("conda run -n openwpm --no-capture-output python -u", [crawl_script, url, "headless", waitingTime], { shell: true, cwd: script_path, stdio: "pipe" });
            } else {
                ls = spawn("conda run -n openwpm --no-capture-output python -u", [crawl_script, url, "native", waitingTime], { shell: true, cwd: script_path, stdio: "pipe" });
            }
            console.log("spawned .py childprocess");

        } else {
            console.error("Fileformat not supported.");
            process.exit();
        }



        // listener for child process
        ls.stdout.on("data", (data) => {
            if (data.toString().includes("browserready")) {

                socket.emit("browserready", client_name);
                console.log("Browser ready for visiting URL");

            } else console.log("stdout: " + data);
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
            if (isCancelled == false){
                console.log("URL done");
                socket.emit("urldone");
            } 
            console.log("Child process closed.");


        })

        return module;

    },
    killCrawler: function () { 
        isCancelled = true;
        ls.kill("SIGINT");
        console.log("Child process killed.");
    },

    spawnProxy: function () {

        let urlSaveName = "/" + tempUrl.replace(/^https?\:\/\//i, "");
        proxy = spawn("mitmdump", ["--listen-host=" + proxy_host, "--listen-port=" + proxy_port, "--set=hardump=" + har_destination + urlSaveName, "-s har_dump.py"]);

        proxy.stderr.on("data", (err) => {

            console.log("proxy error: " + err.toString());

        })

    }
}
