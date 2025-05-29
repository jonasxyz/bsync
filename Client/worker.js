/**
 * @file Client/worker.js
 * @description Worker client script. Connects to the master server to perform web crawling tasks.
 * It receives URLs and manages an automation framework (e.g., Puppeteer, OpenWPM, regular Firefox controlled with an extension)
 * as subprocess to visit these URLs. It collects data and can manage capturing processes like proxies.
 * Communication with the master server for instructions and status updates is done via Socket.IO.
 */
const io = require("socket.io-client");
const fs = require('fs');
const path = require('path'); // For joining paths for log file
var spawnedScripts = require("./functions/spawnScripts.js");
var fileSystemUtils = require("./functions/fileSystemUtils.js");
const { setupWorkerConsoleAndFileLogging } = require("./functions/fileSystemUtils.js"); // Import the new function

const config = require("./config.js");
const { url } = require("inspector");
const masterAdress = config.activeConfig.base.master_addr;
const worker = config.activeConfig.worker;
const baseConfig = config.activeConfig.base;
//var config = require("../config_openwpm.js");

const { colorize } = require("./functions/fileSystemUtils.js");

const dirName = 0;

var waitingTime = 0;
var totalUrlsForFormatting = 0; // Variable to store total URLs for formatting

socket = io(masterAdress,{
  "reconnection" : true,
  "reconnectionDelay" : 1000,
  "timeout" : 5000
});

console.log(colorize("INFO:", "gray") + " Worker Client starting");
console.log(colorize("INFO:", "gray") + " Trying to connect to master server...");


socket.on("connect", () => {
  console.log(colorize("SOCKETIO:", "cyan") + " Client " + socket.id+" succesfully connected");

  // console.log("Client session id: " + socket.sessionid); // debug
  socket.emit("initialization", worker.client_name);

});

socket.on("close", async data => {
  if (data == "toomanyclients") {
    console.log(colorize("ERROR:", "red") + " Too many clients connected. Check num_slaves argument on master server");
  }
  if (data == "finished") {
    console.log(colorize("STATUS:", "green") + " Crawl successfully finished");
    await spawnedScripts.cleanupProcesses(true);
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

// Receive crawl timestamp from scheduler for har remote storage
socket.on("crawlRootDir", async (data) => {
  // console.log("INFO: " + "Received crawl timestamp from master: " + data); // DEBUG
  // crawlTimestamp = data.toString(); // Old way

  if (typeof data === 'object' && data !== null) {
    const receivedTimestamp = data.crawlTimestamp;
    const receivedTotalUrls = data.totalUrls;

    if (receivedTimestamp) {
      // console.log(colorize("INFO:", "gray") + "Received crawl timestamp from master: " + receivedTimestamp); // DEBUG
      // Directly use or pass receivedTimestamp to fileSystemUtils.createDir
      try {
        const crawlDirPath = await fileSystemUtils.createDir(receivedTimestamp.toString());
        // Setup worker logging once the main crawl directory (and its subdirs like logs) are created
        if (crawlDirPath) {
            const logDir = path.join(crawlDirPath, fileSystemUtils.LOGS_SUBDIR);
            const logFileName = `worker_${worker.client_name}.log`;
            setupWorkerConsoleAndFileLogging(logDir, logFileName);
            console.log(`Worker logging to file ${path.join(logDir, logFileName)} enabled.`); // This will also go to the file
        }
      } catch (error) {
        // Use original console here as logging might not be set up yet
        const originalConsoleError = console.error; 
        originalConsoleError(colorize("ERROR:", "red") + " Error creating crawl directory or setting up worker logging:", error);
      }
    } else {
      console.warn(colorize("WARN:", "yellow") + "crawlRootDir event received without crawlTimestamp.");
    }

    if (receivedTotalUrls !== undefined) {
      totalUrlsForFormatting = receivedTotalUrls;
      console.log(colorize("INFO:", "gray") + "Total URLs for formatting set to: " + totalUrlsForFormatting + " (from crawlRootDir)");
    } else {
      console.warn(colorize("WARN:", "yellow") + "crawlRootDir event received without totalUrls.");
    }
  } else {
    // Fallback for old string-only data, though scheduler should now send an object
    console.warn(colorize("WARN:", "yellow") + "crawlRootDir received data in unexpected format. Expecting an object.");
    try {
      await fileSystemUtils.createDir(data.toString()); 
    } catch (error) {
      console.error(colorize("ERROR:", "red") + " Error creating crawl directory with old data format:", error);
    }
  }
});

socket.on("initiate_crawler", async () => {
  console.log("\n" + colorize("SOCKETIO:", "cyan") + " Received Signal initiate_crawler, Crawl started at scheduler");

  console.log(colorize("INFO:", "gray") + " Starting "+ worker.client_name );
  spawnedScripts.spawnCrawler();

});

socket.on("start_capturer", async (jobData) => {
  console.log(colorize("SOCKETIO:", "cyan") + " Received Signal start_capturer, starting capturing method with data:", jobData);
  
  const clearUrl = typeof jobData === 'object' && jobData !== null && jobData.clearUrl !== undefined ? jobData.clearUrl : jobData;
  const urlIndex = typeof jobData === 'object' && jobData !== null ? jobData.urlIndex : undefined; // Will be 1-based

  if (worker.enable_proxy && baseConfig.persistent_proxy == true){
    console.log(colorize("STATUS:", "green") + " Starting persistent proxy");
    await spawnedScripts.spawnProxy(clearUrl);
    
    if (clearUrl) {
        await spawnedScripts.setHarDumpPath(clearUrl);
    }
  }

  if (worker.enable_tcpdump) {
    if (clearUrl) {
        await spawnedScripts.spawnDump(clearUrl);
    } else {
        console.warn(colorize("WARN:", "yellow") + " clearUrl not provided for tcpdump on start_capturer");
    }
  }

  // Create parameters for each URL, including the index
  const iterationConfig = createUrlIterationConfig(clearUrl, urlIndex);

  spawnedScripts.sendVisitUrlCommand(iterationConfig);
});

socket.on("CHECK_READY", async (jobData) => {
  if (!jobData || jobData.clearUrl === undefined || jobData.urlIndex === undefined) {
    console.error(colorize("ERROR:", "red") + " CHECK_READY signal received without clearUrl or urlIndex in jobData.", jobData);
    return;
  }
  const { clearUrl, urlIndex } = jobData;
  console.log(colorize("SOCKETIO:", "cyan") + ` CHECK_READY Received. Next url: "${clearUrl}" (Index: ${urlIndex})`);

  if (worker.enable_proxy && baseConfig.persistent_proxy == false){
    console.log(colorize("STATUS:", "green") + " Starting non-persistent proxy for URL:" + clearUrl);
    await spawnedScripts.spawnProxy(clearUrl);
    await spawnedScripts.setHarDumpPath(clearUrl);
  }

  if (worker.enable_tcpdump) await spawnedScripts.spawnDump(clearUrl);

  spawnedScripts.checkBrowserReady();
});

socket.on("visit_url", async (jobData) => {
  if (!jobData || jobData.clearUrl === undefined || jobData.urlIndex === undefined) {
    console.error(colorize("ERROR:", "red") + " visit_url signal received without clearUrl or urlIndex in jobData.", jobData);
    return;
  }
  const { clearUrl, urlIndex } = jobData;
  console.log(colorize("SOCKETIO:", "cyan") + ` Job received (Signal visit_url) for URL: "${clearUrl}" (Index: ${urlIndex})`);

  // Create parameters for each URL, including the index
  const iterationConfig = createUrlIterationConfig(clearUrl, urlIndex);

  spawnedScripts.sendVisitUrlCommand(iterationConfig);
});

function createUrlIterationConfig(clearUrl, urlIndex) { // urlIndex is 1-based
  const config = {
      url: '',
      userAgent: null,
      waitingTime: 0,
      clearUrl: clearUrl,
      urlIndex: urlIndex, // Already 1-based
      visitDuration: baseConfig.pagevisit_duration,
      totalUrls: totalUrlsForFormatting // Pass totalUrls for formatting
  };
  //console.log("createUrlIterationConfig: " + JSON.stringify(config)); // debug

  if (clearUrl.toString() === "calibration") { // Pass scheduler Webserver as URL
      config.url = masterAdress + "/client/" + socket.id;
      config.userAgent = worker.client_name;
      config.visitDuration = 2;

  } else if (clearUrl.toString() === "test") {
      config.url = masterAdress + "/client/" + socket.id;
      config.userAgent = worker.client_name;
      config.waitingTime = waitingTime;
      config.visitDuration = 2;
      
  } else {
      config.url = normalizeUrl(clearUrl);
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

socket.on("killchildprocess", async data => {

  console.log(colorize("SOCKETIO:", "cyan") + " Signal killchildprocess received from Scheduler");

  if(data.toString() === "timeout"){
    console.log(colorize("BROWSER:", "yellow") + colorize(" Browser timed out at master", "red"));
    await spawnedScripts.cleanupProcesses(false);

  }else{
    console.log(colorize("STATUS:", "green") + " Crawl cancelled at master");
    await spawnedScripts.cleanupProcesses(true);

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

// Export totalUrlsForFormatting for other modules if needed (alternative to passing it through every function)
module.exports = {
  getSocket: () => socket, // If other modules need the socket instance
  getTotalUrlsForFormatting: () => totalUrlsForFormatting
};

// Listen for exit events to avoid zombie child processes
process.on('exit', async () => {
  console.log(colorize("STATUS:", "green") + " Process exit detected, cleaning up...");
  await spawnedScripts.cleanupProcesses(true);
});

process.on('SIGINT', async () => {
  console.log(colorize("STATUS:", "green") + " SIGINT received (Ctrl+C), cleaning up...");
  await spawnedScripts.cleanupProcesses(true);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log(colorize("STATUS:", "green") + " SIGTERM received, cleaning up...");
  await spawnedScripts.cleanupProcesses(true);
  process.exit(0);
});

// TODO: Is closing the processes but also killing when its not wanted, bzw, error message is not shown and process is killed
process.on('uncaughtException', async (error) => {
  console.error(colorize("ERROR:", "red") + " Uncaught Exception:", error);
  await spawnedScripts.cleanupProcesses(true);
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error(colorize("ERROR:", "red") + " Unhandled Rejection at:", promise, 'reason:', reason);
  await spawnedScripts.cleanupProcesses(true);
  process.exit(1);
});

