var statFunctions = require('./functions/statFunctions.js');
var logFunctions = require('./functions/logging.js');
var helperFunctions = require('./functions/helper.js');

var serverFunctions = require('./functions/server.js');
const { app, server} = require('./functions/server.js');



var config = require('./config.js');
const { logMessage } = require('./functions/helper.js');

var prompt = require('prompt');
const fs = require('fs');


const multer = require('multer');
//const express = require('express');
//const app = express();

var io = require("socket.io")(server);
const path = require('path');

process.env.TZ = 'Europe/Amsterdam'; // DEBUG

var arrayClients = []; // Stores connected workers and data for calibration
var arrayStatistics = []; // Stores data while crawling

const iterationState = { // Todo refactor like that
    ongoingCrawl: false,
    calibrationDone: false,
    isAnswered: false,
    activeClients: 0,
};


// Function and variable context
const context = {
    io,
    config,
    arrayClients,
    arrayStatistics,
    logFunctions,
    statFunctions,
    helperFunctions,
    get calibrationDone() { return calibrationDone; },
    get testsDone() { return testsDone; },
    get urlsDone() { return urlsDone; },
    get tempUrl() { return tempUrl; },
    //sendUrl: sendUrl // add later into context
};

var errorHandler = require('./functions/errorHandler.js');

const timeoutHandlers = errorHandler(context);


//var activeClients = 0, urlsDone = 0, pingOkay = 0, testsDone = 0, browsersReady = 0, pendingJobs  = 0; // counters
var activeClients = 0;
var urlsDone = 0;
var pingOkay = 0;
var testsDone = 0;
var browsersReady = 0;
var pendingJobs  = 0;

var pendingRequests = 0;

//var urlList= fs.readFileSync("./"+config.url_list).toString().split("\r\n"); // Create array with one element out of each line
var urlList = fs.readFileSync("./" + config.url_list, 'utf8').split('\r\n').filter(line => line.trim() !== ''); //vmedit

var calibrationDone = false;
var initCalibrationDone = false;
var ongoingCrawl = false;
var isAnswered = false;

var fresh_initialization = true; // todo noch checken wie es ist wenn framework neu gestartet werden muss. und wieder initcrawl kommt


var tempUrl;
var numIterations;
var calibrationTime;
var pingTime;
var dateUrlDone;

var timeUrlSent;
var timeAllBrowsersReady;
var fastestReady;
var slowestReady;

var browserReadyCountdown;
var browserDoneCountdown;

var readyTimeoutCounter; // todo wenn browser x mal nicht ready wird crawl beenden oder option einfügen den crawl mit einem worker weniger fortzusetzen
var doneTimeoutCounter;

var rootDirPath;
var crawlTimestamp;

console.log('\nMaster server is starting...');

// Create directory for crawl logs and storage for HAR-Data
createCrawlDirectory();

if (config.test_run){
    numIterations = config.test_iterations;
    console.log("Starting test run with " + numIterations +" Iterations");
    logFunctions.startLogTesting(new Date().toISOString().split('T')[0], rootDirPath);

}else{
    numIterations = urlList.length;
    console.log("Fetched "+ numIterations+" entries from "+ config.url_list);
    logFunctions.startLog(config.url_list.toString(), new Date().toISOString().split('T')[0], rootDirPath);
}

// Events erklärt  https://socket.io/docs/v4/emitting-events/

io.on("connection", socket => {

    if(activeClients>=config.num_clients){
        console.log("\x1b[31mERROR: " + "Too many clients connected. Check config.num_clients argument."+ "\x1b[0m");
        io.to(socket.id).emit("close", "toomanyclients");
    }

    // Counter for connected clients
    activeClients+=1; 

    // Send number of connected workers to each client //todo unnötig entfernen
    io.to(socket.id).emit("numclients", config.num_clients); 
    
    // Send crawl timestamp to each client for har remote storage
    io.to(socket.id).emit("crawlRootDir", crawlTimestamp); 
    console.log("INFO: " + "Sent crawl timestamp to client: " + crawlTimestamp); // DEBUG


    socket.on("initialization", (clientname)=>{

        socket.data.clientname = clientname;

        logFunctions.logConnect(clientname, new Date().toISOString());

        // Create individual subpages for each client to track their access timing on the scheduler webserver in calibration and test runs
        serverFunctions.createClientSubpages(socket.id, calibrationDone, arrayClients, arrayStatistics, timeUrlSent, timeAllBrowsersReady);

        if(config.central_datastorage) { 
            let preTempUrl = urlList[urlsDone].toString();
            tempUrl = preTempUrl.slice(preTempUrl.indexOf(",") + 1);
            serverFunctions.createClientUploadRoute(socket.id, rootDirPath, tempUrl);
        }

        // Storing connected clients and data for each URL-Iteration while crawling 
        arrayClients.push({ 
            workerName: socket.data.clientname, 
            socketId: socket.id, 
            dateArray: [], 
            readyArray: [], 
            requestArray: [], 
            doneArray: [], 
            browserFinishedArray: [], 
            maxDelayArray: [], 
            avgDelay: 0, 
            waitMs: 0, 
            avgDone: 0, 
            offsetDone: 0
        });
        // Collecting data while calibration
        arrayStatistics.push({ 
            workerName: socket.data.clientname, 
            socketId: socket.id, 
            dateArray: [], 
            readyArray: [], 
            waitingTimeArray: [], 
            requestArray: [], 
            doneArray: [], 
            browserFinishedArray: [], 
            maxDelayArray: [], 
            errorArray: []
        });
 
        console.log("INFO: " + "Client "+clientname + " connected. "+ activeClients+ "/" + config.num_clients+" clients connected to start crawl");

        if(activeClients == config.num_clients && ongoingCrawl==false){                   

            console.log("\x1b[33mSTATUS: \x1b[0m" + "All clients connected. Starting latency test...\n");
            pingTime = Date.now();
            io.sockets.emit("ping");
        }
    
        if (ongoingCrawl == true && activeClients == config.num_clients) {

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Reconnection worked.\nRestarting with calibration then continuing the crawl with the last URL...", "\x1b[0m");

            //io.sockets.emit("killchildprocess", "timeout");

            statFunctions.flushArray(arrayClients, false);
            statFunctions.flushArray(arrayStatistics, true);

            helperFunctions.checkArrayLengths(arrayClients, testsDone, false); //debug

            //console.table(arrayClients); //debug
            //console.table(arrayStatistics); //debug

            // Send readycheck to reconnected client
            io.to(socket.id).emit("initiate_crawler");
            io.to(socket.id).emit("start_capturer", tempUrl);

            // Send check ready to all clients todo somehow check if automation framework is started
            io.sockets.emit("CHECK_READY", tempUrl); 
        }
    })

    socket.on("disconnect", async(data) => {

        tempId = helperFunctions.searchArray(arrayClients, socket.id.toString(), 2);
        testsDone = pingOkay = pendingJobs = 0;
        if(config.re_calibration_dc) calibrationDone = false;
        activeClients-=1;

        clearTimeout(browserReadyCountdown);
        clearTimeout(browserDoneCountdown);

        // search array for disconnected client id and remove element
        // arrayClients.splice(statFunctions.searchArray(arrayClients, socket.id.toString(), 2), 1); 
        arrayClients.splice(tempId, 1); 

        // search statistics array for disconnected client id and remove element
        arrayStatistics.splice(helperFunctions.searchArray(arrayStatistics, socket.data.clientname.toString(), 1), 1); 

        io.emit("activeclients", activeClients);

        if(ongoingCrawl==true && activeClients<config.num_clients){

            console.log("\x1b[31mERROR: " + "Client "+ socket.data.clientname + " disconnected while crawling...\nClient will automatically  try to reconnect.","\x1b[0m");

            logFunctions.logDisconnect(socket.data.clientname, new Date().toISOString());

            // await sleep(300000);
            // console.log("\x1b[31m","Automatic reconnection failed. Please connect Client "+ socket.data.clientname + " manually...","\x1b[0m");  

        }else{

            console.log("\x1b[33mSTATUS: \x1b[0m" + "\nClient "+ socket.data.clientname + " disconnected. "+ activeClients + "/" 
                + config.num_clients+" clients connected to start crawl\n");
        }
    })
    
    // todo maybe implement continuous pingtest before each url
    socket.on("pingresults", (data)=> {

        let latency = (Date.now() - pingTime)/2;
        console.log("INFO: " + "Client "+data +" latency to master server " +latency + " ms");
        logFunctions.logPing(data, new Date().toISOString(), latency);

        if(latency<config.allowed_ping){
            pingOkay+=1;
            
        }else{
            console.log("\x1b[31mERROR: " + "Delay between Client and Master is too high. Edit var allowedDelay if necessary.","\x1b[0m")
            console.log("\x1b[33mSTATUS: \x1b[0m" + 'Shutting down...');
            process.exit();
        }

        if(pingOkay==config.num_clients){

            isAnswered=false;

            if(config.calibration_runs == 0) interfaceQuestion("crawl");
            else interfaceQuestion("calibration"); 
        }
    })
    
    socket.on("scripterror", (data)=> {
        console.log("\x1b[31mERROR: " + "Error at "+ socket.data.clientname+ " while executing crawl script","\x1b[0m");
        // console.log(data); //debug errormsg
        if (calibrationDone){
            let arrayPosition = helperFunctions.searchArray(calibrationDone ? arrayStatistics : arrayClients, socket.data.clientname.toString(), 1);;
            calibrationDone ? (tempArray = arrayStatistics) : (tempArray = arrayClients);
            try {
                var errorLine = data.split('\n').find(line => line.startsWith('Error:')).trim();
                console.log("1errorLine=",errorLine); //debug errormsg

                //const errorDetailsLine = errorString.split('\n')[errorString.split('\n').indexOf(errorLine) + 1].trim();
                //console.log("2errorDetail=",errorDetailsLine); //debug errormsg

            } catch (error) {
                // errorLine = "unknown error"; // todo add error detail handling
            }
            
            tempArray[arrayPosition].errorArray.push(errorLine); // log first line of errormessage //vmedit todo check for other error and openwpm
        }
    })

    socket.on("URL_DONE", (data) => {

        dateUrlDone = Date.now();

        let arrayPosition = helperFunctions.searchArray(calibrationDone ? arrayStatistics : arrayClients, socket.data.clientname.toString(), 1);;
        calibrationDone ? (tempArray = arrayStatistics) : (tempArray = arrayClients);

        // Insert time from sending url to receiving urlDone into statistics 
        tempArray[arrayPosition].doneArray.push((dateUrlDone - timeUrlSent));
        //console.log ("pushed " + (dateUrlDone - timeUrlSent)); // debug

    })

    // Triggered everytime one browser finished while crawling
    socket.on("ITERATION_DONE", async (data) => { 

        if (activeClients != config.num_clients || ongoingCrawl == false ) return;  //|| awaiting != "browserfinished"
        // removed || browsersReady != config.num_clients // vmedit 17:21 23-07-24 auch 21:38 25-07-24

        pendingJobs -= 1;

        let arrayPosition = helperFunctions.searchArray(calibrationDone ? arrayStatistics : arrayClients, socket.data.clientname.toString(), 1);;

        calibrationDone ? (tempArray = arrayStatistics, tempIterations = 0) : (tempArray = arrayClients , tempIterations = testsDone);

        //insert time from sending url to receiving urlDone into statistics 
        //tempArray[arrayPosition].doneArray.push((dateUrlDone - timeUrlSent));
        
        var tempDateUrlDone = tempArray[arrayPosition].doneArray[tempIterations]; //
        //var tempDateUrlDone = Date.now();  03 altaber wieder rückgängig

        //console.log(tempDateUrlDone +" MINUS " + timeUrlSent) // DEBUG
        
        let dateBrowserFinsihed = Date.now(); //vmedit add browserfinished log

        // tempArray[arrayPosition].browserFinishedArray.push((dateBrowserFinsihed - timeUrlSent)); 03 kann weg glaub ich, ersetzen durch doneArray, scheint auch
        // nichtmehr vorkzukommen.
        tempArray[arrayPosition].browserFinishedArray.push((dateBrowserFinsihed - timeUrlSent));

        if(tempDateUrlDone == undefined){

            let MissingUrlCrawled = true;
            tempDateUrlDone = -1;
            console.log("\x1b[31mERROR: " + socket.data.clientname.toString() + " error visiting URL....", "\x1b[0m");

            // console.log("neue funktion timeout urldone fehlt");
            // browserDoneTimeout(true);   // VMEDIT dont kill all browsers if that happens
        } 

        //if(! (config.test_run == false && calibrationDone == true )) {  // always except normal crawl after calibration
        if(config.test_run == true || calibrationDone == false) {  // always except normal crawl after calibration
            // todo ? eigentlich nur bei testrun oder calibration

            console.log("\x1b[34mURLDONE:\x1b[0m",  tempArray[arrayPosition].workerName , " URL done signal \x1b[34m",
                    ( tempDateUrlDone -  tempArray[arrayPosition].requestArray[tempIterations]) , "ms\x1b[0m after receiving request"
                    + " \x1b[36m" , (tempDateUrlDone - timeUrlSent ) + "\x1b[0m ms after starting iteration. "); //VMEDIT

            // console.log( (dateUrlDone - timeUrlSent) - tempArray[arrayPosition].requestArray[tempIterations] , " " , dateUrlDone , " - " , tempArray[arrayPosition].requestArray[tempIterations] ); //debug

        }

        if (calibrationDone == true) { // everytime one browser finished while crawling

            let calibrationArrayPosition =  helperFunctions.searchArray(arrayClients, socket.data.clientname.toString(), 1);

            tempWaitingTime = arrayClients[calibrationArrayPosition].waitMs;
            tempArray[arrayPosition].waitingTimeArray.push(tempWaitingTime);

            if(config.test_run == false){

                tempArray[arrayPosition].dateArray.push(new Date(tempDateUrlDone + timeUrlSent).toISOString()); 

                var estimatedRequest;
                if(tempDateUrlDone == undefined ||tempDateUrlDone == -1 ){ // vmedit undefined if not done
                    estimatedRequest = undefined;

                }else{
                    estimatedRequest = tempDateUrlDone  - arrayClients[calibrationArrayPosition].offsetDone;
                }    

                // console.log ((dateUrlDone - timeUrlSent) , " minus " + arrayClients[calibrationArrayPosition].offsetDone , " gleich " , estimatedRequest ); //debug
                tempArray[arrayPosition].requestArray.push(estimatedRequest);

                console.log("\x1b[34mCRAWLED:\x1b[0m", arrayClients[calibrationArrayPosition].workerName , "crawled URL", tempUrl , "finished\x1b[34m",
                tempDateUrlDone , "ms\x1b[0m after distributing URL");
                //console.log("\x1b[34mCRAWLED:\x1b[0m", arrayClients[calibrationArrayPosition].workerName , "crawled URL", tempUrl , "finished\x1b[34m",
                    //tempDateUrlDone , "ms\x1b[0m after distributing URL. Estimated Request\x1b[34m ",estimatedRequest , "ms\x1b[0m after distribution");
                    // Todo estimatedRequest not working
            }            
        }
  
        if (pendingJobs == 0 && calibrationDone == false) { // if all browser done the url in calibration

            // Insert stats into array
            var maxDelay = statFunctions.getMaxDelay(arrayClients, testsDone);
            statFunctions.insertMaxDelay(arrayClients, maxDelay, testsDone);
            

            clearTimeout(browserDoneCountdown);
            logFunctions.logCalibration(arrayClients, testsDone);

            testsDone += 1;

            // helperFunctions.checkArrayLengths(arrayClients, testsDone, false); // Debug

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Calibration #" + testsDone + " Delay between first and last HTTP Request", "\x1b[33m", + statFunctions.getMaxDelay(arrayClients, testsDone-1) + " ms" , "\x1b[0m");


            if (testsDone == config.calibration_runs ) { // Calibration iterations done
        
                calibration();

                if (initCalibrationDone == false) { 

                    let calibrationTookMs = Date.now() - calibrationTime;

                    console.log("INFO: " + "Calibration took " + Math.round(calibrationTookMs / 1000) + " seconds.");
                    console.log("INFO: " + "Average delay between first and last HTTP request from " + testsDone + " test runs is " +
                        // Math.round( acessDelay.reduce((a, b) => (a + b)) / acessDelay.length )
                        (arrayClients[arrayClients.length - 1].avgDelay - arrayClients[0].avgDelay) + " ms", "\x1b[0m");

                  
                    let estimatedCrawlTime = ((numIterations / config.calibration_runs) * calibrationTookMs) + ((numIterations / config.re_calibration) * calibrationTookMs);
                    console.log("INFO: " + "Estimated time to crawl " + numIterations + " websites is " + estimatedCrawlTime + "ms " + helperFunctions.msToHours(estimatedCrawlTime) + " hours.");
                    
                    initCalibrationDone = true;
                    //console.table(arrayClients) //debug
                }
               
                calibrationTime = 0;
                testsDone= 0;
                //sendUrl(false); 

            }else{ // If calibration done else continue calibration

                //sendUrl(true);
            }


        }else if (pendingJobs == 0 && calibrationDone == true) { // if all browser finished the url in normal crawl

            clearTimeout(browserDoneCountdown);
            doneTimeoutCounter = 0;
            urlsDone += 1;
            //console.log("incremented urlsDone: " + urlsDone); // debug


            //helperFunctions.checkArrayLengths(arrayStatistics, urlsDone, true); //debug
            // console.table(arrayStatistics);

            // calculate maximum delay between incoming http requests 
            statFunctions.insertMaxDelay(arrayStatistics, statFunctions.getMaxDelay(arrayStatistics, 0));

            if(config.test_run) statFunctions.calcHttpDelayV2(arrayStatistics, urlsDone);

            // logFunctions.logTesting(arrayStatistics, urlsDone);
            logFunctions.logCrawling(arrayStatistics,urlsDone, tempUrl.toString());
            
            console.log("\x1b[33mSTATUS: \x1b[0m" + "URL " + urlsDone , " of " , numIterations + " done");
            //console.table(arrayStatistics);
            //statFunctions.flushArray(arrayStatistics, true); 
            statFunctions.flushArrayExceptBrowserReady(arrayStatistics, true); // todo check 26.11


            if( urlsDone == numIterations){

                console.log("\x1b[33mSTATUS: \x1b[0m" + "All Websites crawled.\nShutting down server...", "\x1b[0m");
                io.sockets.emit("close", "finished");
                process.exit();

            } else if (config.re_calibration != 0 && urlsDone % config.re_calibration == 0) { // recalibrate after number of website crawled 

                console.log("\x1b[33mSTATUS: \x1b[0m" + "\x1b[32m", "Starting recalibration...", "\x1b[0m")
                calibrationDone = false;
                statFunctions.flushArray(arrayClients, false);
                // sendUrl(true); // begin recalibration 03

            } else {
                //send url from urllist to all clients if end of urlList not reached
                // sendUrl(false); 03
            }
        }
        if(pendingJobs == 0) {
            //sendUrl(); // 19.11 
            //socket.emit("CHECK_READY");

            // Get the next URL
            tempUrl = retrieveUrl();

            io.sockets.emit("CHECK_READY", tempUrl);
            helperFunctions.logMessage("status", "CHECK_READY sent to all workers");

            console.log("\n--------------------------------------------------------------------------------------------------------------\n")
        }
    })

    socket.on("browser_ready", (data)=> {   

        //console.log("browser_ready triggered"); // debug
        if (activeClients != config.num_clients || ongoingCrawl == false) return;

        let tempName = socket.data.clientname.toString();

        timeBrowserReady = (Date.now() - timeUrlSent);

        if (browsersReady == 0) fastestReady = timeBrowserReady;
        if (browsersReady == config.num_clients - 1) slowestReady = timeBrowserReady;


        calibrationDone ? (tempArray = arrayStatistics, iterations = 0) : (tempArray = arrayClients, iterations = testsDone);

        // Search arrays for right worker and push time it took for browser to start in the array
        let arrayPosition = helperFunctions.searchArray(tempArray, tempName, 1);

        // Check if the browser ready signal is unique
        if (tempArray[arrayPosition].readyArray.length == iterations) {  // changed
            tempArray[arrayPosition].readyArray.push(timeBrowserReady);

            browsersReady += 1;
            console.log("\x1b[33mSTATUS: \x1b[0m" + browsersReady + "/" + config.num_clients + " " + data + "'s browser ready");

        } else {

            tempArray[arrayPosition].readyArray.splice(iterations, 0, timeBrowserReady); 19.11

            helperFunctions.logMessage("debug", "Overwriting ready status");
            console.log("\x1b[33mSTATUS: \x1b[0m" + browsersReady + "/" + config.num_clients + " " + data + "'s browser ready");
        }

        if (browsersReady == config.num_clients) { // If all workers signalized that their browser is ready

            timeAllBrowsersReady = Date.now();

            clearTimeout(browserReadyCountdown);


            console.log("INFO: " + "Delay compensated between first and last browser ready to visit website " + (slowestReady - fastestReady) + " ms");


            //io.emit("browser_go"); // distribute signal to access the url after all browser are ready
            // 03 muss zu visit_url werden brauch ich eigentlich nicht mehr
            
            // if (urlsDone == 0 && fresh_initialization == true){ // 19.11 nur noch bei erster url, sonst senden bei iteration done

            //     fresh_initialization = false;
            //     sendUrl(); // 19.11 nur noch bei erster url, sonst senden bei iteration done
            //     console.log("INFO: " + "First URL sent to all browsers");

            // }

            sendUrl(); // change check_ready 


            //start timeout if one browser wont visitwebsite
            //browserDoneCountdown = setTimeout(browserDoneTimeout(false), config.timeout_ms);

            //browserDoneCountdown = setTimeout(browserDoneTimeout, config.timeout_ms, false); 28
            browserDoneCountdown = setTimeout(() => timeoutHandlers.browserDoneTimeout(false), config.timeout_ms); 


            // browsersReady = 0; 
        }
    })

    function initiate_crawler(start_capturer = true){
        io.sockets.emit("initiate_crawler");
        logMessage("status", "Starting crawlers");
        ongoingCrawl=true;

        // Retrieve the first URL
        if (!tempUrl) {
            tempUrl = retrieveUrl();
        }

        //console.log("calibration", calibrationDone, "initcal", initCalibrationDone); // DEBUG

        // Start capturer if requested
        console.log("start_capturer", tempUrl);
        if (start_capturer) io.sockets.emit("start_capturer", tempUrl);
    }
    context.initiate_crawler = initiate_crawler;

    function retrieveUrl(){
        //if(calibration == true){    // while calibrating schedulers ip adress is distributed to the clients
        if(calibrationDone == false){ // 03 changed
           //tempUrl = ip+":"+port;
           if(initCalibrationDone==false && testsDone==0) calibrationTime = Date.now();
           tempUrl = "calibration";
           pendingRequests += config.num_clients;
           
        }else{

            if(config.test_run){
                tempUrl =  "test";
                pendingRequests += config.num_clients; // changed
            } 
            else {
                preTempUrl = urlList[urlsDone].toString();
                tempUrl = preTempUrl.slice(preTempUrl.indexOf(",") + 1);
                logFunctions.newUrl(tempUrl, urlsDone+1, new Date().toISOString());

            }


        }
        return tempUrl;
    }
    context.retrieveUrl = retrieveUrl;

    function sendUrl(calibration){

        //calibrationDone ? (tempArray = arrayStatistics) : (tempArray = arrayClients);

        arrayStatistics.forEach(element => {
            //console.log(element.readyArray.length +" kleiner" + testsDone) // debug
            if(element.readyArray.length = 0){
                console.log("WARNING: sendUrl called but not all browsers have ready values. Ready browsers: " + browsersReady + "/" + config.num_clients);
                return;
            }
        });

        // if (browsersReady != config.num_clients) {
        //     console.log("WARNING: sendUrl called but not all browsers are ready. Ready browsers: " + browsersReady + "/" + config.num_clients);
        //     return;
        // }
        ongoingCrawl = true;
        pendingJobs = 0;
        pendingRequests = 0;
        browsersReady = 0; // 03 glaub doch hier

        // if(urlsDone != 0){
        //     retrieveUrl();
        // }

        if(urlsDone == numIterations){
            console.log("\x1b[33mSTATUS: \x1b[0m" + "All Websites crawled.\nShutting down server...", "\x1b[0m");
            io.sockets.emit("close", "finished");
            process.exit();
        }

        
        // io.sockets.emit("url", tempUrl);  //03 muss zu visit_url werden
        io.sockets.emit("visit_url", tempUrl);

        timeUrlSent = Date.now();
        pendingJobs += config.num_clients;


        if(calibrationDone == true) console.log("\x1b[33mSTATUS: \x1b[0m" + "URL#"+ (urlsDone+1) + " sent " + tempUrl);

        // if(calibrationDone) console.log("\x1b[33mSTATUS: \x1b[0m" + "URL#"+ (urlsDone+1) + " sent " + tempUrl); // vmedit 16:09 23-07-24
        else console.log("\x1b[33mSTATUS: \x1b[0m" + "calibration#" + (testsDone+1) + " sent to all workers"); 

        // Countdown is started and gets resolved when all browser are ready // todo dynamic timeout - 3x from calibration
        browserReadyCountdown = setTimeout(browserReadyTimeout, 120000 ) 
    }
    context.sendUrl = sendUrl; // todo check 010325 kann wahrscheinlich weg

    
    function interfaceQuestion(operation) {

        var debug_skip_confirmation = true;

        // Skip confirmation if debug flag is set
        if (debug_skip_confirmation) {
            if (operation === "calibration" && isAnswered === false) {
                initiate_crawler();
            }
            if (operation === "crawl" && isAnswered === false) {
                initiate_crawler();
                calibrationDone = true;
                initCalibrationDone = true;
                console.log("No Calibration");
            }
            isAnswered = true;
            return;
        }

        helperFunctions.getUserConfirmation(operation, (err, confirmation) => {
    
            if (confirmation === 'y' || confirmation === 'yes') {
                if (operation === "calibration" && isAnswered === false) {
                    //sendUrl(true); // start testing accesstime to  master webserver for calibration
                    initiate_crawler(); // 03
                }
    
                if (operation === "crawl" && isAnswered === false) {
                    //sendUrl(false);
                    initiate_crawler(); // 03
                    calibrationDone = true; // vmedit skipcalibration
                    initCalibrationDone = true;
                    console.log("No Calibration");
                }
                isAnswered = true; // avoid buffered interface questions when client loses connection while question is active
                return;
            }
            console.log("\x1b[33mSTATUS: \x1b[0m" + 'Shutting down...');
            io.sockets.emit("close", "cancel");
            process.exit();
        });
    }

    //todo der der austimet behält zombie child
    function browserDoneTimeout(alreadyClosed){

        console.log("BrowserdoneTimeout triggered..")

        let tempId;
        let tempName;
        let tempIterations;

        calibrationDone ? (tempArray = arrayStatistics, tempIterations = 0) : (tempArray = arrayClients , tempIterations = testsDone);

        tempArray.forEach(element => {
    
            if (element.doneArray.length - 1 != tempIterations) { // check which worker did not finish
                tempId = element.socketId;
                tempName = element.workerName.toString();

            }

        });

        if(!alreadyClosed) {
            console.log("sending kill")
            io.sockets.emit("killchildprocess", "timeout");
        }
        

        console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out while visiting URL...\nKilling all browsers.", "\x1b[0m");
        

        doneTimeoutCounter += 1;


        if(doneTimeoutCounter == config.website_attempts && calibrationDone == true) { // if browsers timed out configured times at the current website the URL will be skipped

            urlsDone += 1;
            doneTimeoutCounter = 0;
            clearTimeout(browserDoneCountdown);
            statFunctions.flushArray(arrayStatistics, true);


            //io.sockets.emit("killchildprocess", "timeout");
            logFunctions.logTimeout(tempName, new Date().toISOString(), doneTimeoutCounter, urlsDone+1);

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Skipping url#" + urlsDone + " " + tempUrl + " after failing to crawl " + (config.website_attempts) + " times.");
            logFunctions.skipUrl(tempUrl.toString(), urlsDone, new Date().toISOString());

            sendUrl(false);
            return;
        }

        if (calibrationDone == false) {

            statFunctions.removeExtraStats(arrayClients, testsDone, false);
            //console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out at calibration while visiting URL...\nKilling all browsers.", "\x1b[0m");

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Restarting calibration#" + testsDone);
            sendUrl(true);

            logFunctions.logTimeout(tempName, new Date().toISOString(), doneTimeoutCounter, testsDone);

        } else {

            statFunctions.flushArray(arrayStatistics, true);
            //console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out while visiting URL...\nKilling all browsers.", "\x1b[0m");

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Resending url#" + (urlsDone + 1) + " " + tempUrl + " to all workers.");
            sendUrl(false);

            logFunctions.logTimeout(tempName, new Date().toISOString(), doneTimeoutCounter, urlsDone+1);

        }
 
    }

    process.on("SIGINT", function(){
        io.sockets.emit("killchildprocess", "cancel");
        //io.sockets.emit("close", "kill")
        console.log("\x1b[33mSTATUS: \x1b[0m" +"Aborting, closing all child processes on clients...");
        process.exit();
    });
    
    socket.on('uploadFile1', (data) => { // todo remove har upload http
        const { fileName, fileBuffer } = data;
        //createCrawlDirectory();
        // Save the file to disk
        //const fileName = `data.${data.client_name}`;
        const filePath = createCrawlDirectory() + '/' + fileName;
        fs.writeFile(filePath, fileBuffer, (err) => {
            if (err) {
                console.error('File save error:', err);
                socket.emit('uploadError', 'File save failed');
            } else {
                console.log('File saved successfully');
                socket.emit('uploadSuccess', 'File saved successfully');
            }
        });
        
    });

    socket.once('uploadFile', (data) => { // todo remove har upload http
        const { fileName, fileBuffer } = data;

        console.log("\x1b[33mSTATUS: \x1b[0m" +"Receiving uploadFile signal");

        createCrawlDirectory()
            .then((dirPath) => {
                const filePath = path.join(dirPath, fileName);
                fs.writeFile(filePath, fileBuffer, (err) => {
                    if (err) {
                        console.error('File save error:', err);
                        socket.emit('uploadError', 'File save failed');
                    } else {
                        console.log('File', fileName, "saved successfully");
                        socket.emit('uploadSuccess', 'File saved successfully');
                    }
                });
            })
            .catch((err) => {
                console.error('Directory creation failed:', err);
                socket.emit('uploadError', 'Directory creation failed');
            });
    });

})

function browserReadyTimeout(){ // timeout if the browser ready signal ist not received within the timelimit 

    let tempId;
    let tempName;
   
    calibrationDone ? (tempArray = arrayStatistics, iterations = 0) : (tempArray = arrayClients, iterations = testsDone);

    if(activeClients == config.num_clients){

        tempArray.forEach(element => {
            //console.log(element.readyArray.length +" kleiner" + testsDone) // debug
            if(element.readyArray.length-1 != iterations){
                tempId = element.socketId;
                tempName = element.workerName.toString();
                
            }
        });
    }   

    if (tempId != undefined) { // kill and restart timed out browser

        console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out while starting...\nTrying to kill childprocess.", "\x1b[0m");
        logFunctions.logTimeoutStarting(tempName, new Date().toISOString());

        io.to(tempId).emit("killchildprocess", "timeout"); //https://azimi.me/2014/12/31/kill-child_process-node-js.html

        console.log("\x1b[33mSTATUS: \x1b[0m" + "Restarting timed out browser " + tempName)

        //await sleep(30000);
        browserReadyCountdown = setTimeout(browserReadyTimeout, 120000); // restart the timeout

        if (config.test_run) io.to(tempId).emit("url", "test");
        else io.to(tempId).emit("url", tempUrl);

        console.log("\x1b[33mSTATUS: \x1b[0m" + "Resending URL " + tempUrl + " to " + tempName);

    }
}

async function createCrawlDirectory() {
    return new Promise((resolve, reject) => {
        if (!rootDirPath) {

            const now = new Date();
            const dateString = now.toISOString().slice(0, 10);
            const timeString = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    
            const crawlDirTimestamp = `${dateString}_${timeString}`;

            const crawlDir = `Crawl_${crawlDirTimestamp}`;
            crawlTimestamp = crawlDir;
            
            // rootDirPath = path.join(__dirname, 'CrawlData', crawlDir); // crawlDir in repository
            rootDirPath = path.join(config.storage_path, crawlDir);


            // Create the root directory
            fs.mkdir(rootDirPath, { recursive: true }, (err) => {
                if (err) {
                    console.error('Failed to create root crawl directory:', err);
                    rootDirPath = null; // Reset if there's an error
                    return reject(err);
                }
                console.log('Root crawl directory created:', crawlDir);
                return resolve(rootDirPath);

                // Now create the URL-specific subdirectory
                // createUrlSubdirectory(rootDirPath, resolve, reject);
            });
        }
    });
}

function createUrlSubdirectory(rootDirPath) {
    return new Promise((resolve, reject) => {
        const urlDirPath = path.join(rootDirPath, tempUrl);
        fs.mkdir(urlDirPath, { recursive: true }, (err) => {
            if (err) {
                console.error('Failed to create URL subdirectory:', err);
                return reject(err);
            } else {
                console.log('URL subdirectory created:', urlDirPath);
                resolve(urlDirPath);
            }
        });
    });
}

async function calibration(){

    for (var i = 0; i < arrayClients.length; i++) {

        // calculate average time gathered from the calibibration between sending url to receiving the http request
        arrayClients[i].avgDelay = Math.round(arrayClients[i].requestArray.reduce((a, b) => (a + b)) / arrayClients[i].requestArray.length);

        // calculate average time between sending url and done signal
        arrayClients[i].avgDone = Math.round(arrayClients[i].doneArray.reduce((a, b) => (a + b)) / arrayClients[i].doneArray.length);

    }

    arrayClients.sort(helperFunctions.dynamicSort("avgDelay"));


    for (let i = 0; i < arrayClients.length ; i++) {

        // Calculate the difference between each worker to the slowest
        let timeToLast = arrayClients[arrayClients.length - 1].avgDelay - arrayClients[i].avgDelay;
        arrayClients[i].waitMs = timeToLast;

        // Distribute the calculated time to wait before each website access to the clients
        io.to(arrayClients[i].socketId).emit("waitingtime", timeToLast);

        console.log("\x1b[33mSTATUS: \x1b[0m" + "Waiting time " + timeToLast + " ms delivered to " + arrayClients[i].workerName);

        // Calculate average offset between the urldone signal and the real http request
        let offsetToDone =  arrayClients[i].avgDone - arrayClients[i].avgDelay;
        arrayClients[i].offsetDone = offsetToDone;

        console.log("\x1b[33mSTATUS: \x1b[0m" + arrayClients[i].workerName + " average offset from request to urldone signal " + offsetToDone + " ms");
        
    }

    calibrationDone = true;

}
