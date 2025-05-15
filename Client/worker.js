const io = require("socket.io-client");
const fs = require('fs');
var spawnedScripts = require("./functions/spawnScripts.js");

const config = require("./config.js");
const { url } = require("inspector");
const masterAdress = config.activeConfig.base.master_addr;
const worker = config.activeConfig.worker;
const baseConfig = config.activeConfig.base;
//var config = require("../config_openwpm.js");

const { colorize } = require("./functions/spawnScripts.js"); // Colorize function for terminal output



const dirName = 0;

var crawlTimestamp;

var waitingTime = 0;

socket = io(masterAdress,{
  "reconnection" : true,
  "reconnectionDelay" : 1000,
  "timeout" : 5000
});

console.log(colorize("INFO:", "gray") + " Worker Client starting");
console.log(colorize("INFO:", "gray") + " Trying to connect to master server...");


socket.on("connect", data => {
  console.log(colorize("SOCKETIO:", "cyan") + " Client " + socket.id+" succesfully connected");

  // console.log("Client session id: " + socket.sessionid); // debug
  socket.emit("initialization", worker.client_name);

});

socket.on("close", data => {
  if (data == "toomanyclients") {
    console.log(colorize("ERROR:", "red") + " Too many clients connected. Check num_slaves argument on master server");
  }
  if (data == "finished") {
    console.log(colorize("STATUS:", "green") + " Crawl successfully finished");
  }
  if (data == "cancel") {
    console.log(colorize("STATUS:", "green") + " Crawl was cancelled");
  }
  console.log(colorize("INFO:", "gray") + " Shutting down...");
  process.exit();
});

socket.on("disconnect", () =>{
  console.log(colorize("SOCKETIO:", "cyan") + colorize(" Lost connection to master server.", "red"));
});


socket.io.on("reconnect", (attempt)=>{
  console.log(colorize("SOCKETIO:", "cyan") + " Automatic reconnection successfull on " +attempt +". attempt.");
});

socket.io.on("reconnect_attempt", (attempt)=>{
  console.log(colorize("SOCKETIO:", "cyan") + " Trying to reconnect.");
});

socket.on("ping", function(){
  console.log(colorize("SOCKETIO:", "cyan") + " Testing latency to master server...");
  socket.emit("pingresults", worker.client_name);
})

// Receive crawl timestamp from scheduler for har remote storage path
socket.on("crawlRootDir", async (data) => {
  // console.log("INFO: " + "Received crawl timestamp from master: " + data); // DEBUG
  crawlTimestamp = data.toString();

  try {
    await spawnedScripts.createDir(crawlTimestamp);
  } catch (error) {
    console.error(colorize("ERROR:", "red") + " Error creating crawl directory:", error);
  }
});

// socket.on("url", async data => {

//   console.log("\n\n\x1b[36mSOCKETIO:\x1b[0m Job received (Signal url) " + data );
//   //console.log("\n\njob received " + data);


//   // spawn browser with paramters for calibration, test or normal crawl
//   if (data.toString() === "calibration") {

//     spawnedScripts.spawnCrawler(masterAdress, worker.proxy_host, worker.client_name, 0, "calibration");

//   }else if (data.toString() === "test") {

//     spawnedScripts.spawnCrawler(masterAdress, worker.proxy_host, worker.client_name, waitingTime, "calibration");

//   }else {

//     // For now puppeteer does not append the protocol automatically  https://pptr.dev/api/puppeteer.page.goto

//     if (!/^(?:f|ht)tps?\:\/\//.test(data)) {
//       url = "http://" + data;
//     } else {
//       url = data;
//     } 

//     spawnedScripts.spawnCrawler( url, worker.proxy_host, "False", waitingTime, data);

//   }

//   // Spawn capturer moved to back
//   if (worker.enable_proxy) await spawnedScripts.spawnProxy(data);
//   if (worker.enable_tcpdump) await spawnedScripts.spawnDump(data);

// })
socket.on("initiate_crawler", async data => {
  console.log("\n" + colorize("SOCKETIO:", "cyan") + " Received Signal initiate_crawler, Crawl started at scheduler");

  //const config = createCrawlConfig(data);
  console.log(colorize("INFO:", "gray") + " Starting "+ worker.client_name );
  spawnedScripts.spawnCrawler();



});

socket.on("start_capturer", async data => {
  console.log(colorize("SOCKETIO:", "cyan") + " Received Signal start_capturer, starting capturing method");

  if (worker.enable_proxy && baseConfig.persistent_proxy == true){
    console.log(colorize("STATUS:", "green") + " Starting persistent proxy");
    await spawnedScripts.spawnProxy(data)

    // Set har dump path for first URL
    // console.log("STATUS: Setting har dump path for first URL", data);
    await spawnedScripts.setHarDumpPath(data);
    
    //.then(async () => { // hier ist die url noch nicht bekannt, besser mit visit url zusammen irgendwann.
      //await spawnedScripts.setHarDumpPath(data); //syntax? // starting proxy here for first URL
    //});

  }

  // Spawn capturer moved to back
  //if (worker.enable_proxy) await spawnedScripts.spawnProxy(data);
  //if (worker.enable_tcpdump) await spawnedScripts.spawnDump(data);
  if (worker.enable_tcpdump) await spawnedScripts.spawnDump(data);

});

socket.on("CHECK_READY", async data => {
  console.log(colorize("SOCKETIO:", "cyan") + " CHECK_READY Received. Next url: \"" + data + "\"");

  if (worker.enable_proxy && baseConfig.persistent_proxy == false){
    console.log(colorize("STATUS:", "green") + " Starting non-persistent proxy");
    await spawnedScripts.spawnProxy(data);
    await spawnedScripts.setHarDumpPath(data);

  }

  if (worker.enable_tcpdump) await spawnedScripts.spawnDump(data);

  //spawnedScripts.clearHarFlows();

  spawnedScripts.checkBrowserReady();
});

socket.on("visit_url", async data => {
  console.log(colorize("SOCKETIO:", "cyan") + " Job received (Signal url) " + data);

  // Create parameters for each URL
  const config = createUrlIterationConfig(data);

  // Spawn capturer moved to back

  spawnedScripts.sendVisitUrlCommand(config);

  // if (browser && browser.stdin) {

  //   let jsonSignal = "visit_url " + JSON.stringify(config) + "\n";
  //   browser.stdin.write(jsonSignal);
  // } else {
  //   console.error("Browser process is not available.");
  // }
});

function createUrlIterationConfig(data) {
  const config = {
      url: '',
      userAgent: null,
      waitingTime: 0,
      clearUrl: data,
      visitDuration: baseConfig.pagevisit_duration,
  };
  //console.log("createUrlIterationConfig: " + JSON.stringify(config)); // debug

  if (data.toString() === "calibration") { // Pass scheduler Webserver as URL
      config.url = masterAdress + "/client/" + socket.id;
      config.userAgent = worker.client_name;
      config.visitDuration = 2;

  } else if (data.toString() === "test") {
      config.url = masterAdress + "/client/" + socket.id;
      config.userAgent = worker.client_name;
      config.waitingTime = waitingTime;
      config.visitDuration = 2;
      
  } else {
      config.url = normalizeUrl(data);
      config.userAgent = "False";
      config.waitingTime = waitingTime;
  }

  return config;
}

// socket.on("url", async data => {
//   console.log("\n\n\x1b[36mSOCKETIO:\x1b[0m Job received (Signal url) " + data);

//   const config = createCrawlConfig(data);

//   spawnedScripts.spawnCrawler(config);

//   // Spawn capturer moved to back
//   if (worker.enable_proxy) await spawnedScripts.spawnProxy(data);
//   if (worker.enable_tcpdump) await spawnedScripts.spawnDump(data);

 
// });

function createCrawlConfig(data) {
  const config = {
      //url: '',
      proxyHost: worker.proxy_host,
      proxyPort: worker.proxy_port,
      //userAgent: worker.client_name,
      //waitingTime: 0,
      //clearUrl: data,
      headless: worker.headless,
      crawldatapath: worker.crawl_data_path,
      stateless: worker.stateless,
  };

  if (data.toString() === "calibration") { // pass scheduler Webserver as URL to visit
      config.url = masterAdress;
      config.userAgent = worker.client_name;
  } else if (data.toString() === "test") {
      config.url = masterAdress;
      config.userAgent = worker.client_name;
      config.waitingTime = waitingTime;
  } else {
      config.url = normalizeUrl(data);
      config.userAgent = "False";
      config.waitingTime = waitingTime;
  }

  return config;
}

// For now puppeteer does not append the protocol automatically https://pptr.dev/api/puppeteer.page.goto
function normalizeUrl(data) {
  if (!/^(?:f|ht)tps?\:\/\//.test(data)) {
      return "http://" + data;
  }
  return data;
}

socket.on("killchildprocess", data => {

  console.log(colorize("SOCKETIO:", "cyan") + " Signal killchildprocess received from Scheduler");

  if(data.toString() === "timeout"){
    console.log(colorize("BROWSER:", "yellow") + colorize(" Browser timed out at master", "red"));
    spawnedScripts.cleanupProcesses(false);

  }else{
    console.log(colorize("STATUS:", "green") + " Crawl cancelled at master");
    spawnedScripts.cleanupProcesses(true);

  }

});

  // Saving har file 
socket.on("savehar", async data => {

  console.log(colorize("SOCKETIO:", "cyan") + " Signal savehar received");

  spawnedScripts.handleHarFile();
});

// Distribute waiting time to all workers
socket.on("waitingtime", data => {

  console.log(colorize("SOCKETIO:", "cyan") + " Signal waitingtime received");

  waitingTime = data;
  console.log(colorize("INFO:", "gray") + " Calibration done: Waiting " +waitingTime +" ms before each website visit.");
});

// Listen for exit events to avoid zombie child processes
// process.on('exit', async () => await spawnedScripts.cleanupProcesses(true));
// process.on('SIGINT', async () => await spawnedScripts.cleanupProcesses(true));
// process.on('SIGTERM', async () => await spawnedScripts.cleanupProcesses(true));


// TODO: Is closing the processes but also killing when its not wanted, bzw, error message is not shown and process is killed
process.on('uncaughtException', async () => await spawnedScripts.cleanupProcesses(true));
process.on('unhandledRejection', async () => await spawnedScripts.cleanupProcesses(true));

