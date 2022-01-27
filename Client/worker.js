const io = require("socket.io-client")

const path = require('path');
const {spawn} = require('child_process');
var spawnedScripts = require("./functions/spawnScripts.js");

/********************************************************************************************************************************/
const client_name = "puppeteer"
const headless = true;

const crawl_script = "startPuppeteer.js" // e.g. "puppeteer.js"
const script_path = "./"
const master_addr = "http://192.168.178.73:3000" // e.g. "http://localhost:3000"

const proxy_host = "localhost";
const proxy_port = "3031";
const proxy_script_location ="/home/user/Schreibtisch/client/poc6plus/functions"
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

  if (data.toString() === "test") {
    spawnedScripts.spawnCrawler(crawl_script, master_addr, client_name, script_path, headless, disable_proxy, proxy_host, proxy_port, client_name, 0); //hier war socket.id

    console.log("starting calibration");
  } else {

    if (!/^(?:f|ht)tps?\:\/\//.test(data)) {
      url = "http://" + data;
    } else {
      url = data;
    }

    
    

    spawnedScripts.spawnCrawler(crawl_script, url, client_name, script_path, headless, disable_proxy, proxy_host, proxy_port, "False", waitingTime);
    //console.log(spawnedScripts.mycrawler)
  } //https://stackoverflow.com/questions/57108371/exporting-multiple-functions-with-arguments

  if (disable_proxy==false){
    spawnedScripts.spawnProxy(proxy_host, proxy_port, har_destination, proxy_script_location);
  } 

})

socket.on("killchildprocess", data => {

  console.log("Crawl cancelled at master\nKilling child process...");
  //if(spawnedScripts.mycrawler !== undefined) {
    //spawnedScripts.mycrawler.kill("SIGINT");
    spawnedScripts.killCrawler();

});

socket.on("browsergo", data => {
  
  ls.stdin.write("visiturl\n");
});

socket.on("waitingtime", data => {

  waitingTime = data;
  console.log("Calibration done: Waiting " +waitingTime +" ms before each website visit.");
});
