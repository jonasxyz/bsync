const io = require("socket.io-client")

const path = require('path');
var spawnedScripts = require("./functions/spawnScripts.js");

/********************************************************************************************************************************/
const client_name = "StealthyWPM"
const headless = false;

const crawl_script = "openwpm_synced.py" // e.g. "puppeteer.js"
const script_path = "/home/user/Schreibtisch/client/StealthyWPM/"
//const script_path = "/home/user/Schreibtisch/client/OpenWPM/"

const master_addr = "http://192.168.178.73:3000" // e.g. "http://localhost:3000"

const disable_proxy = false; // set true to disable mitmproxy
const har_destination = "/home/user/Schreibtisch/client/http_v2/" // e.g. "/home/user/http/"

const proxy_host = "127.0.0.1";
const proxy_port = "3031";
const proxy_script_location ="/home/user/Schreibtisch/client/"
/*******************************************************************************************************************************/

var waitingTime = 0;

socket = io(master_addr,{
  "reconnection" : true,
  "reconnectionDelay" : 1000,
  "timeout" : 5000
});

console.log("client starting")
console.log("client trying to connect to master server...");


socket.on("connect", data => {
  console.log("Client " + socket.id+" succesfully connected");
  socket.emit("initialization", client_name);

});

socket.on("close", data => {
  if (data == "toomanyclients") {
    console.log("Too many clients connected. Check num_slaves argument on master server");
  }
  if (data == "finished") {
    console.log("Crawl successfully finished");
  }
  if (data == "cancel") {
    console.log("Crawl was cancelled");
  }
  console.log("Shutting down...");
  process.exit();
});

socket.on("disconnect", () =>{
  console.log("Lost connection to master server.");
});


socket.io.on("reconnect", (attempt)=>{
  console.log("Automatic reconnection successfull on " +attempt +". attempt.");
});

socket.io.on("reconnect_attempt", (attempt)=>{
  console.log("Trying to reconnect.");
});


socket.on("ping", function(){
  console.log("Testing latency to master server...");
  socket.emit("pingresults", client_name);
})


socket.on("url", data => {

  if (disable_proxy==false){
    spawnedScripts.spawnProxy(proxy_host, proxy_port, har_destination, proxy_script_location, data);
  } 
  if (data.toString() === "calibration") {
    spawnedScripts.spawnCrawler(crawl_script, master_addr, client_name, script_path, headless, disable_proxy, proxy_host, proxy_port, client_name, 0); //hier war socket.id
    console.log("starting calibration");

  }else if (data.toString() === "test") {

    spawnedScripts.spawnCrawler(crawl_script, master_addr, client_name, script_path, headless, disable_proxy, proxy_host, proxy_port, client_name, waitingTime); //hier war socket.id
    console.log("starting test run");

  }else {

    if (!/^(?:f|ht)tps?\:\/\//.test(data)) {
      url = "http://" + data;
    } else {
      url = data;
    }  

    spawnedScripts.spawnCrawler(crawl_script, url, client_name, script_path, headless, disable_proxy, proxy_host, proxy_port, "False", waitingTime);

  } 

})

socket.on("killchildprocess", data => {

  if(data.toString() === "timeout"){
    console.log("Browser timed out");

  }else{
    console.log("Crawl cancelled at master");

  }   
  spawnedScripts.killCrawler();

});

socket.on("browsergo", data => {
  
  ls.stdin.write("visiturl\n");
});

socket.on("waitingtime", data => {

  waitingTime = data;
  console.log("Calibration done: Waiting " +waitingTime +" ms before each website visit.");
});
