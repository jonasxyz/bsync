const io = require("socket.io-client");
const fs = require('fs');
var spawnedScripts = require("./functions/spawnScripts.js");

const config = require("./config.js");
const masterAdress = config.base.master_addr;
const worker = config.worker;
//var config = require("../config_openwpm.js");

const dirName = 0;

var waitingTime = 0;

socket = io(masterAdress,{
  "reconnection" : true,
  "reconnectionDelay" : 1000,
  "timeout" : 5000
});

console.log("client starting");
console.log("Client trying to connect to master server...");


socket.on("connect", data => {
  console.log("Client " + socket.id+" succesfully connected");
  socket.emit("initialization", worker.client_name);

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
  socket.emit("pingresults", worker.client_name);
})


socket.on("url", async data => {

  console.log("\n\n\x1b[36mSOCKETIO:\x1b[0m Job received (Signal url) " + data );
  //console.log("\n\njob received " + data);


  // spawn browser with paramters for calibration, test or normal crawl
  if (data.toString() === "calibration") {

    spawnedScripts.spawnCrawler(masterAdress, worker.proxy_host, worker.client_name, 0, "calibration");

  }else if (data.toString() === "test") {

    spawnedScripts.spawnCrawler(masterAdress, worker.proxy_host, worker.client_name, waitingTime, "calibration");

  }else {

    // For now puppeteer does not append the protocol automatically  https://pptr.dev/api/puppeteer.page.goto

    if (!/^(?:f|ht)tps?\:\/\//.test(data)) {
      url = "http://" + data;
    } else {
      url = data;
    } 

    spawnedScripts.spawnCrawler( url, worker.proxy_host, "False", waitingTime, data);

  }

  // Spawn capturer moved to back
  if (worker.enable_proxy) await spawnedScripts.spawnProxy(data);
  if (worker.enable_tcpdump) await spawnedScripts.spawnDump(data);

})

socket.on("killchildprocess", data => {

  console.log("\x1b[36mSOCKETIO:\x1b[0m Signal killchildprocess received");

  if(data.toString() === "timeout"){
    console.log("Browser timed out at master");

  }else{
    console.log("Crawl cancelled at master");

  }   
  spawnedScripts.killCrawler();

});

socket.on("browsergo", data => {

  console.log("\x1b[36mSOCKETIO:\x1b[0m Signal browsergo received");

  browser.stdin.write("visiturl\n");
});

socket.on("waitingtime", data => {

  console.log("\x1b[36mSOCKETIO:\x1b[0m Signal waitingtime received");

  waitingTime = data;
  console.log("Calibration done: Waiting " +waitingTime +" ms before each website visit.");
});


process.on("SIGINT", async function(){

  console.log("\nClosing child processes before exiting..");
  await spawnedScripts.killCrawler();
  console.log("Exiting");
  process.exit();
  

  //kill(1, "SIGKILL", (err) => {
    //if(err) console.log(err)
    //console.log("Exiting");
    //process.exit();

  //});
  
});