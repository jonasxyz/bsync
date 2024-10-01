var statFunctions = require('./functions/statFunctions.js');
var logFunctions = require('./functions/logging.js');
var helperFunctions = require('./functions/helper.js');
var config = require('./config.js');
const { logMessage } = require('./functions/helper.js');

var prompt = require('prompt');
const fs = require('fs');
const multer = require('multer');
const express = require('express');
const app = express();

var server = app.listen(config.port, () => logMessage("status", 'Server listening on port ' + config.port +"\n"));



var io = require("socket.io")(server);
const path = require('path');

process.env.TZ = 'Europe/Amsterdam'; // DEBUG

var arrayClients = []; // Stores connected workers and data for calibration
var arrayStatistics = []; // Stores data while crawling

const state = { // Todo refactor like that
    ongoingCrawl: false,
    calibrationDone: false,
    isAnswered: false,
};


//var activeClients = 0, urlsDone = 0, pingOkay = 0, testsDone = 0, browsersReady = 0, pendingJobs  = 0; // counters
var activeClients = 0;
var urlsDone = 0;
var pingOkay = 0;
var testsDone = 0;
var browsersReady = 0;
var pendingJobs  = 0;

//var urlList= fs.readFileSync("./"+config.url_list).toString().split("\r\n"); // Create array with one element out of each line
var urlList = fs.readFileSync("./" + config.url_list, 'utf8').split('\r\n').filter(line => line.trim() !== ''); //vmedit

var calibrationDone = false;
var initCalibrationDone = false;
var ongoingCrawl = false;
var isAnswered = false;

// var awaiting;

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

    
    activeClients+=1; // Counter for connected clients

    io.to(socket.id).emit("numclients", config.num_clients); // Send number of connected workers to each client //todo unnötig entfernen
    
    socket.on("initialization", (clientname)=>{

        socket.data.clientname = clientname;

        logFunctions.logConnect(clientname, new Date().toISOString());

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

            console.table(arrayClients); //debug
            console.table(arrayStatistics); //debug

            sendUrl(true);
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


        arrayStatistics.splice(helperFunctions.searchArray(arrayStatistics, socket.data.clientname.toString(), 1), 1); // search statistics array for disconnected client id and remove element

        io.emit("activeclients", activeClients);


        if(ongoingCrawl==true && activeClients<config.num_clients){

            console.log("\x1b[31mERROR: " + "Client "+ socket.data.clientname + " disconnected while crawling...\nClient will automatically  try to reconnect.","\x1b[0m");

            
            logFunctions.logDisconnect(socket.data.clientname, new Date().toISOString());

            // await sleep(300000);
            // console.log("\x1b[31m","Automatic reconnection failed. Please connect Client "+ socket.data.clientname + " manually...","\x1b[0m");  

        }else{

            console.log("\x1b[33mSTATUS: \x1b[0m" + "\nClient "+ socket.data.clientname + " disconnected. "+ activeClients + "/" + config.num_clients+" clients connected to start crawl\n");
        }
    })
    
    // todo vielleicht fortlaufenden pingtest vor jeder url - sonst macht allowedping keinen sinn
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
         console.log(data); //debug errormsg
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

    socket.on("urlcrawled", (data) => {

        dateUrlDone = Date.now();

        let arrayPosition = helperFunctions.searchArray(calibrationDone ? arrayStatistics : arrayClients, socket.data.clientname.toString(), 1);;
        calibrationDone ? (tempArray = arrayStatistics) : (tempArray = arrayClients);

        //insert time from sending url to receiving urlDone into statistics 
        tempArray[arrayPosition].doneArray.push((dateUrlDone - timeUrlSent));
        //console.log ("pushed " + (dateUrlDone - timeUrlSent));


    })

    socket.on("browserfinished", async (data) => {

        if (activeClients != config.num_clients || ongoingCrawl == false || browsersReady != config.num_clients ) return;  //|| awaiting != "browserfinished"
        // removed || browsersReady != config.num_clients // vmedit 17:21 23-07-24 auch 21:38 25-07-24

        // triggered everytime one browser finished while crawling

        
        pendingJobs -= 1;
        

        let arrayPosition = helperFunctions.searchArray(calibrationDone ? arrayStatistics : arrayClients, socket.data.clientname.toString(), 1);;


        calibrationDone ? (tempArray = arrayStatistics, tempIterations = 0) : (tempArray = arrayClients , tempIterations = testsDone);

        //insert time from sending url to receiving urlDone into statistics 
        //tempArray[arrayPosition].doneArray.push((dateUrlDone - timeUrlSent));
        
        var tempDateUrlDone = tempArray[arrayPosition].doneArray[tempIterations];

        //console.log(tempDateUrlDone +" MINUS " + timeUrlSent) // DEBUG
        
        let dateBrowserFinsihed = Date.now(); //vmedit add browserfinished log

        tempArray[arrayPosition].browserFinishedArray.push((dateBrowserFinsihed - timeUrlSent));



        // neuoktober browser closed but didnt send urlcrawled signal
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
                tempDateUrlDone , "ms\x1b[0m after distributing URL. Estimated Request\x1b[34m ",estimatedRequest , "ms\x1b[0m after distribution");

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
                    console.table(arrayClients) //debug
                }
               
                calibrationTime = 0;
                testsDone= 0;
                sendUrl(false); 

            }else{ // If calibration done else continue calibration

                sendUrl(true);
            }


        }else if (pendingJobs == 0 && calibrationDone == true) { // if all browser finished the url in normal crawl

            clearTimeout(browserDoneCountdown);
            doneTimeoutCounter = 0;
            urlsDone += 1;

            //helperFunctions.checkArrayLengths(arrayStatistics, urlsDone, true); //debug
            // console.table(arrayStatistics);


            // calculate maximum delay between incoming http requests 
            statFunctions.insertMaxDelay(arrayStatistics, statFunctions.getMaxDelay(arrayStatistics, 0));

            if(config.test_run) statFunctions.calcHttpDelayV2(arrayStatistics, urlsDone);

            // logFunctions.logTesting(arrayStatistics, urlsDone);
            logFunctions.logCrawling(arrayStatistics,urlsDone, tempUrl.toString());
            
            console.log("\x1b[33mSTATUS: \x1b[0m" + "URL " + urlsDone , " of " , numIterations + " done");
            console.table(arrayStatistics);
            statFunctions.flushArray(arrayStatistics, true); 


            if( urlsDone == numIterations){

                console.log("\x1b[33mSTATUS: \x1b[0m" + "All Websites crawled.\nShutting down server...", "\x1b[0m");
                io.sockets.emit("close", "finished");
                process.exit();

            } else if (config.re_calibration != 0 && urlsDone % config.re_calibration == 0) { // recalibrate after number of website crawled 

                console.log("\x1b[33mSTATUS: \x1b[0m" + "\x1b[32m", "Starting recalibration...", "\x1b[0m")
                calibrationDone = false;
                statFunctions.flushArray(arrayClients, false);
                sendUrl(true); // begin recalibration

            } else {

                //send url from urllist to all clients if end of urlList not reached
                sendUrl(false); 
            }
        }

        
    })


    socket.on("browserready", (data)=> {   

        if (activeClients != config.num_clients || ongoingCrawl == false) return;

        let tempName = socket.data.clientname.toString();

        timeBrowserReady = (Date.now() - timeUrlSent);

        if (browsersReady == 0) fastestReady = timeBrowserReady;
        if (browsersReady == config.num_clients - 1) slowestReady = timeBrowserReady;


        calibrationDone ? (tempArray = arrayStatistics, iterations = 0) : (tempArray = arrayClients, iterations = testsDone);

        //search arrays for right worker and push time it took for browser to start in the array
        let arrayPosition = helperFunctions.searchArray(tempArray, tempName, 1);

        // check if the browser ready signal is unique
        if (tempArray[arrayPosition].readyArray.length == iterations) {  // changed
            tempArray[arrayPosition].readyArray.push(timeBrowserReady);

            browsersReady += 1;
            console.log("\x1b[33mSTATUS: \x1b[0m" + browsersReady + "/" + config.num_clients + " " + data + "'s browser ready");

        } else {

            tempArray[arrayPosition].readyArray.splice(iterations, 0, timeBrowserReady);

            console.log("overwriting ready status"); //debug
            console.log("\x1b[33mSTATUS: \x1b[0m" + browsersReady + "/" + config.num_clients + " " + data + "'s browser ready");

        }


        if (browsersReady == config.num_clients) { // if all workers signalized that their browser is ready

            timeAllBrowsersReady = Date.now();

            clearTimeout(browserReadyCountdown);


            console.log("INFO: " + "Delay compensated between first and last browser ready to visit website " + (slowestReady - fastestReady) + " ms");


            io.emit("browsergo"); // distribute signal to access the url after all browser are ready

            //start timeout if one browser wont visitwebsite
            //browserDoneCountdown = setTimeout(browserDoneTimeout(false), config.timeout_ms);
            browserDoneCountdown = setTimeout(browserDoneTimeout, config.timeout_ms, false);

            // browsersReady = 0; 
        }

    })

    function sendUrl(calibration){

        ongoingCrawl=true;
        pendingJobs = 0;
        pendingRequests = 0;
        browsersReady = 0;

        if(urlsDone == numIterations){
            console.log("\x1b[33mSTATUS: \x1b[0m" + "All Websites crawled.\nShutting down server...", "\x1b[0m");
            io.sockets.emit("close", "finished");
            process.exit();
        }

        if(calibration == true){    // while calibrating schedulers ip adress is distributed to the clients
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
        io.sockets.emit("url", tempUrl);
        timeUrlSent = Date.now();
        pendingJobs += config.num_clients;

        console.log("\n--------------------------------------------------------------------------------------------------------------\n")

        if(calibration == false) console.log("\x1b[33mSTATUS: \x1b[0m" + "URL#"+ (urlsDone+1) + " sent " + tempUrl);

        // if(calibrationDone) console.log("\x1b[33mSTATUS: \x1b[0m" + "URL#"+ (urlsDone+1) + " sent " + tempUrl); // vmedit 16:09 23-07-24
        else console.log("\x1b[33mSTATUS: \x1b[0m" + "calibration#" + (testsDone+1) + " sent to all workers"); 

        //changed added timeout
        browserReadyCountdown = setTimeout(browserReadyTimeout, 120000 ) // countdown is started and gets resolved when all browser are ready // todo dynamic timeout - 3x from calibration
    }

    function interfaceQuestion(operation) {

        helperFunctions.getUserConfirmation(operation, (err, confirmation) => {
    
            if (confirmation === 'y' || confirmation === 'yes') {
                if (operation === "calibration" && isAnswered === false) {
                    sendUrl(true); // start testing accesstime to  master webserver for calibration
                }
    
                if (operation === "crawl" && isAnswered === false) {
                    sendUrl(false);
                    calibrationDone = true; // vmedit skipcalibration
                    initCalibrationDone = true;
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
    
    socket.on('uploadFile1', (data) => {
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

    socket.once('uploadFile', (data) => {
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

function createCrawlDirectory() {
    return new Promise((resolve, reject) => {
        if (!rootDirPath) {
            const crawlDir = `crawl_${Date.now()}`;
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


    for (let i = 0; i < arrayClients.length ; i++) { // cahnged -1 weg

        // calculate the difference between each worker to the slowest
        let timeToLast = arrayClients[arrayClients.length - 1].avgDelay - arrayClients[i].avgDelay;
        arrayClients[i].waitMs = timeToLast;

        //distribute the calculated time to wait before each website access to the clients
        io.to(arrayClients[i].socketId).emit("waitingtime", timeToLast);

        console.log("\x1b[33mSTATUS: \x1b[0m" + "Waiting time " + timeToLast + " ms delivered to " + arrayClients[i].workerName);

        // calculate average offset between the urldone signal and the real http request
        let offsetToDone =  arrayClients[i].avgDone - arrayClients[i].avgDelay;
        arrayClients[i].offsetDone = offsetToDone;

        console.log("\x1b[33mSTATUS: \x1b[0m" + arrayClients[i].workerName + " average offset from request to urldone signal " + offsetToDone + " ms");
        
    }

    calibrationDone = true;

}

app.get('/', async function (req, res) {

    if (activeClients != config.num_clients || ongoingCrawl == false) return;

    var accessTime = Date.now();
    accesDate = new Date(accessTime).toISOString();

    tempUserAgent = req.get('user-agent').toString(); // identify the http request by setting the user-agent on the worker while calibrating

    let tempName;


    calibrationDone ? (tempArray = arrayStatistics) : (tempArray = arrayClients);

    if (calibrationDone == false || config.test_run == true) {

        let arrayPosition = helperFunctions.searchArray(tempArray, tempUserAgent.toString(), 4);

        tempArray[arrayPosition].requestArray.push((accessTime - timeUrlSent)); // milliseconds from sending url to client to receiving http request // old accessTime - timeAllBrowsersReady


        tempArray[arrayPosition].dateArray.push(accesDate);
        tempName = tempArray[arrayPosition].workerName;
    }
    
    
    console.log("\x1b[36mREQUEST:\x1b[0m HTTP Request from " + tempName + " \x1b[36m" + (accessTime - timeUrlSent) + "\x1b[0m ms after starting iteration. " , (accessTime - timeAllBrowsersReady )
        + " ms after sending browsergo signal");


    //res.send('measuring browser access time!');
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Calibration</title>
            <style>
                body {
                    background-color: red;
                    margin: 0;
                    height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    color: white;
                    font-size: 2em;
                }
            </style>
        </head>
        <body>
            measuring browser access time!
        </body>
        </html>
    `);
    

}); 


let completedUploads = 0;
let uniqueUploads = new Set(); // Set to track unique uploads

// Configure multer for file storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Create directory for storing the files
        // createCrawlDirectory() old
        createUrlSubdirectory(rootDirPath)
            .then(dirPath => {
                cb(null, dirPath); // Pass the directory path to Multer as the destination
            })
            .catch(err => {
                console.error('Directory creation failed:', err);
                cb(err);
            });
    },
    filename: (req, file, cb) => {
        let uploadUserAgentStorage = req.get('User-Agent'); // Get User-Agent header

        cb(null, uploadUserAgentStorage + '_' + file.originalname); //todo check
    }
});

const upload = multer({ storage: storage });

// Endpoint for file upload
app.post('/upload', upload.single('file'), (req, res) => {
    uploadUserAgent = req.get('User-Agent'); // identify the http-request by setting the user-agent on the worker

    if (req.file) {

        if (uniqueUploads.has(uploadUserAgent)) {
            // Duplicate upload detected
            console.error(`Duplicate upload detected from client ${uploadUserAgent} for file ${req.file.filename}`);
            return res.status(400).send('Duplicate upload detected');
        }

        console.log("INFO: " + "File" , req.file.filename, "saved successfully from client", uploadUserAgent);
        uniqueUploads.add(uploadUserAgent);
        completedUploads++;

        if (completedUploads === config.num_clients) {
            logMessage("status", "All clients have uploaded their data.");
            completedUploads = 0;
        }

        res.status(200).send('File saved successfully');
    } else {
        console.error('File save error');
        res.status(500).send('File save failed');

    }
});