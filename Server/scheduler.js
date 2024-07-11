var statFunctions = require('./functions/statFunctions.js');
var logFunctions = require('./functions/logging.js');
var helperFunctions = require('./functions/helper.js');
var config = require('./config.js');

var prompt = require('prompt');

const fs = require('fs');

const express = require('express');
const app = express();
var server = app.listen(config.port, () => console.log("Server listening on port " + config.port +"\n"));

var io = require("socket.io")(server);



// todo vielleicht estimatedRequest hinzufügen 
// bester zeitpunkt ein signal schicken und dann ins normale array rein um etwas nachvollziehen zu können wann die request auf den websites eingehen

var arrayClients = []; // stores connected workers and data for calibration

var arrayStatistics = []; // stores data while crawling

//var activeClients = 0, urlsDone = 0, pingOkay = 0, testsDone = 0, browsersReady = 0, pendingJobs  = 0; // counters
var activeClients = 0;
var urlsDone = 0;
var pingOkay = 0;
var testsDone = 0;
var browsersReady = 0;
var pendingJobs  = 0;
var myPromise;
// zwei gleiche crawler http informationen vergleichen

var urlList= fs.readFileSync("./"+config.url_list).toString().split("\r\n"); // create array with one element out of each line

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



console.log('\nMaster server is starting...');

if (config.test_run){
    numIterations = config.test_iterations;
    console.log("Starting test run with " + numIterations +" Iterations");
    logFunctions.startLogTesting(new Date().toISOString().split('T')[0]);

}else{
    numIterations = urlList.length;
    console.log("Fetched "+ numIterations+" entries from "+ config.url_list);
    logFunctions.startLog(config.url_list.toString(), new Date().toISOString().split('T')[0]);

} 


//events erklärt  https://socket.io/docs/v4/emitting-events/

io.on("connection", socket => {

    if(activeClients>=config.num_clients){
        console.log("\x1b[31mERROR: " + "Too many clients connected. Check config.num_clients argument."+ "\x1b[0m");
        io.to(socket.id).emit("close", "toomanyclients");
    }

    
    activeClients+=1; // counter for connected clients

    io.to(socket.id).emit("numclients", config.num_clients); // send number of connected workers to each client //todo unnötig entfernen
    
    socket.on("initialization", (clientname)=>{

        socket.data.clientname = clientname;

        logFunctions.logConnect(clientname, new Date().toISOString());

      
        arrayClients.push({ workerName: socket.data.clientname, socketId: socket.id, dateArray: [], readyArray: [], requestArray: [], doneArray: [], maxDelayArray: [], avgDelay: 0, waitMs: 0, avgDone: 0, offsetDone: 0});
        arrayStatistics.push({ workerName: socket.data.clientname, socketId: socket.id, dateArray: [], readyArray: [], waitingTimeArray: [], requestArray: [], doneArray: [], maxDelayArray: [] });
 
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
        calibrationDone = false;
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
         console.log(data); //debug
    })

    socket.on("urlcrawled", (data) => {

        dateUrlDone = Date.now();

        let arrayPosition = helperFunctions.searchArray(calibrationDone ? arrayStatistics : arrayClients, socket.data.clientname.toString(), 1);;
        calibrationDone ? (tempArray = arrayStatistics) : (tempArray = arrayClients);

        //insert time from sending url to receiving urlDone into statistics 
        tempArray[arrayPosition].doneArray.push((dateUrlDone - timeUrlSent));
        console.log ("pushed " + (dateUrlDone - timeUrlSent)) 
        
    })

    socket.on("browserfinished", async (data) => {

        if (activeClients != config.num_clients || ongoingCrawl == false || browsersReady != config.num_clients ) return;  //|| awaiting != "browserfinished"


        // triggered everytime one browser finished while crawling

        
        pendingJobs -= 1;
        

        let arrayPosition = helperFunctions.searchArray(calibrationDone ? arrayStatistics : arrayClients, socket.data.clientname.toString(), 1);;


        calibrationDone ? (tempArray = arrayStatistics, tempIterations = 0) : (tempArray = arrayClients , tempIterations = testsDone);

        //insert time from sending url to receiving urlDone into statistics 
        //tempArray[arrayPosition].doneArray.push((dateUrlDone - timeUrlSent));
        let tempDateUrlDone = tempArray[arrayPosition].doneArray[tempIterations];

        console.log(tempDateUrlDone +" MINUS " + timeUrlSent)


        // neuoktober browser closed but didnt send urlcrawled signal
        if(tempDateUrlDone == undefined){

            let MissingUrlCrawled = true;
            tempDateUrlDone = -1;
            console.log("\x1b[31mERROR: " + socket.data.clientname.toString() + " timed out visiting URL....", "\x1b[0m");

            console.log("neue funktion timeout urldone fehlt");
            browserDoneTimeout(true);   
        } 


        //if(! (config.test_run == false && calibrationDone == true )) {  // always except normal crawl after calibration
        if(config.test_run == true || calibrationDone == false) {  // always except normal crawl after calibration
            // todo ? eigentlich nur bei testrun oder calibration

            console.log("\x1b[34mURLDONE:\x1b[0m",  tempArray[arrayPosition].workerName , " URL done signal \x1b[34m",
                    ( tempDateUrlDone -  tempArray[arrayPosition].requestArray[tempIterations]) , "ms\x1b[0m after receiving request");

            // console.log( (dateUrlDone - timeUrlSent) - tempArray[arrayPosition].requestArray[tempIterations] , " " , dateUrlDone , " - " , tempArray[arrayPosition].requestArray[tempIterations] ); //debug

        }

        if (calibrationDone == true) { // everytime one browser finished while crawling

            let calibrationArrayPosition =  helperFunctions.searchArray(arrayClients, socket.data.clientname.toString(), 1);

            tempWaitingTime = arrayClients[calibrationArrayPosition].waitMs;
            tempArray[arrayPosition].waitingTimeArray.push(tempWaitingTime);

            if(config.test_run == false){

                tempArray[arrayPosition].dateArray.push(new Date(tempDateUrlDone + timeUrlSent).toISOString()); 

                console.log("\x1b[34mCRAWLED:\x1b[0m", arrayClients[calibrationArrayPosition].workerName , "crawled URL", tempUrl , "finished\x1b[34m",
                tempDateUrlDone , "ms\x1b[0m after distribtung URL");

                let estimatedRequest = tempDateUrlDone  - arrayClients[calibrationArrayPosition].offsetDone;
                // console.log ((dateUrlDone - timeUrlSent) , " minus " + arrayClients[calibrationArrayPosition].offsetDone , " gleich " , estimatedRequest ); //debug
                tempArray[arrayPosition].requestArray.push(estimatedRequest);


            }            

        }
  


        if (pendingJobs == 0 && calibrationDone == false) { // if all browser done the url in calibration

            // await myPromise; // pendingRequestsTry

            // insert stats into array
            var maxDelay = statFunctions.getMaxDelay(arrayClients, testsDone);
            statFunctions.insertMaxDelay(arrayClients, maxDelay, testsDone);
            

            clearTimeout(browserDoneCountdown);
            logFunctions.logCalibration(arrayClients, testsDone);

            testsDone += 1;

            // helperFunctions.checkArrayLengths(arrayClients, testsDone, false); //debug

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Calibration #" + testsDone + " Delay between first and last HTTP Request", "\x1b[33m", + statFunctions.getMaxDelay(arrayClients, testsDone-1) + " ms" , "\x1b[0m");


            if (testsDone == config.calibration_runs ) { // calibration iterations done
        
                // await sleep(4000);

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

            }else{ // if calibration done else continue calibration

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

            } else if (urlsDone % config.re_calibration == 0) { // recalibrate after number of website crawled 

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
            }


        }
        io.sockets.emit("url", tempUrl);
        timeUrlSent = Date.now();
        pendingJobs += config.num_clients;

        console.log("\n--------------------------------------------------------------------------------------------------------------\n")

        if(calibrationDone) console.log("\x1b[33mSTATUS: \x1b[0m" + "URL#"+ (urlsDone+1) + " sent " + tempUrl);
        else console.log("\x1b[33mSTATUS: \x1b[0m" + "calibration#" + (testsDone+1) + " sent to all workers"); 

        //changed added timeout
        browserReadyCountdown = setTimeout(browserReadyTimeout, 120000 ) // countdown is started and gets resolved when all browser are ready // todo dynamic timeout - 3x from calibration
    }

    function interfaceQuestion(operation) {
        prompt.message = '';
        prompt.start();
        prompt.get({
            properties: {

                confirm: {
                    // allow yes, no, y, n, YES, NO, Y, N as answer
                    pattern: /^(yes|no|y|n)$/gi,
                    description: "\nDo you want to start the " + operation + " ? (y/n)\n",
                    message: 'Type yes/no',
                    required: true,
                    default: 'yes'
                }
            }
        }, function (err, result) {
            try {
                var c = result.confirm.toLowerCase();
            }catch(e){
                console.log("\x1b[33mSTATUS: \x1b[0m" + 'Shutting down...');
                io.sockets.emit("close", "cancel");
                process.exit();
            }

            if (c == 'y' || c == 'yes') {
                if (operation == "calibration" && isAnswered==false) sendUrl(true); // start testing accesstime to  master webserver for calibration
                      
                if (operation == "crawl" && isAnswered==false) sendUrl(false);
                isAnswered=true; // avoid bufferd interface questions when client loses connection while question is active
                return;

            }
            console.log("\x1b[33mSTATUS: \x1b[0m" + 'Shutting down...');
            io.sockets.emit("close", "cancel");
            process.exit();
        });

    }

    //todo der der austimet behält zombie child
    function browserDoneTimeout(alreadyClosed){

        console.log("BrowserdoneTimeour triggered..")

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
    
})


function sleep(ms) {
    // console.log("waiting") //debug

    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

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

    let accessTime = Date.now();
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

    console.log("\x1b[36mREQUEST:\x1b[0m HTTP Request from " + tempName + " \x1b[36m" + (accessTime - timeUrlSent) + "\x1b[0m ms after starting iteration. " + (accessTime - timeAllBrowsersReady)
        + " ms after sending ready signal");

    // pendingRequests -=1; // pendingRequestsTry
    // if(pendingRequests==0) {
    //     console.log("request done")
    //     myPromise = new Promise(function(resolve, reject) {
    //         console.log("resolved"):
    //         resolve();
    //       });
    // }

    res.send('measuring browser access time!');


}); 
