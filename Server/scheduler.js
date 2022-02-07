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
var receivedRequests = 0; //hoftix
// zwei gleiche crawler http informationen vergleichen

var urlList= fs.readFileSync("./"+config.url_list).toString().split("\r\n"); // create array with one element out of each line

var calibrationDone = false;
var initCalibrationDone = false;
var ongoingCrawl = false;
var lostConnection = false;
var isAnswered = false;

var tempUrl;
var numIterations;
var calibrationTime;
var pingTime;

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

}else{
    numIterations = urlList.length;
    console.log("Fetched "+ numIterations+" entries from "+ config.url_list);
} 

// if(config.calibration_runs < 1) calibrationDone = initCalibrationDone = true; unnötig 

//events erklärt  https://socket.io/docs/v4/emitting-events/

//numClients und activeClients an Clients zu schicken im Moment keine Funktionalität außer log auf den Clients

io.on("connection", socket => {

    if(activeClients>=config.num_clients){
        console.log("\x1b[31mERROR: " + "Too many clients connected. Check config.num_clients argument."+ "\x1b[0m");
        io.to(socket.id).emit("close", "toomanyclients");
    }

    
    activeClients+=1; // counter for connected clients

    io.to(socket.id).emit("numclients", config.num_clients); // send number of connected workers to each client //todo unnötig entfernen
    io.emit("activeclients", activeClients);
    
    socket.on("initialization", (clientname)=>{

        socket.data.clientname = clientname;

        logFunctions.logConnect(clientname, new Date().toISOString());

      
        arrayClients.push({ workerName: socket.data.clientname, socketId: socket.id, dateArray: [], readyArray: [], requestArray: [], doneArray: [], maxDelayArray: [], avgDelay: 0, waitMs: 0});


        // search for existing element or create new
        if (lostConnection) {

            for (var i = 0; i < arrayStatistics.length - 1; i++) {
                if (arrayStatistics[i].workerName == socket.data.clientname.toString()) {
                    arrayStatistics[i].socketId = socket.id;
                    console.log("Existing worker reconnected");
                }
                if (i == arrayStatistics.length - 1) {

                    arrayStatistics.push({ workerName: socket.data.clientname, socketId: socket.id, dateArray: [], readyArray: [], waitingTimeArray: [], requestArray: [], doneArray: [], maxDelayArray: []});

                }
 
            }
        } else {

            arrayStatistics.push({ workerName: socket.data.clientname, socketId: socket.id, dateArray: [], readyArray: [], waitingTimeArray: [], requestArray: [], doneArray: [], maxDelayArray: [] });

        }
        console.log("INFO: " + "Client "+clientname + " connected. "+ activeClients+ "/" + config.num_clients+" clients connected to start crawl");

 
        if(activeClients==config.num_clients && ongoingCrawl==false){                   

            console.log("\x1b[33mSTATUS: \x1b[0m" + "All clients connected. Starting latency test...\n");
            pingTime = Date.now();
            io.sockets.emit("ping");
        }
    
 
        if (ongoingCrawl == true && activeClients == config.num_clients) {

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Reconnection worked.\nRestarting with calibration then continuing the crawl with the last URL...", "\x1b[0m");
            browsersReady = 0;

            io.sockets.emit("killchildprocess", "timeout");

            statFunctions.flushCalibrationArray(arrayClients);
            statFunctions.removeExtraStats(arrayStatistics, urlsDone, true);

            helperFunctions.checkArrayLengths(arrayClients, testsDone, false); //debug

            console.table(arrayClients);
            console.table(arrayStatistics);

            sendUrl(true);
        }
    })

    socket.on("disconnect", async(data) => {

        tempId = helperFunctions.searchArray(arrayClients, socket.id.toString(), 2);
        testsDone = 0;
        calibrationDone = false;
        activeClients-=1;
        pingOkay = 0;
        pendingJobs = 0;

        clearTimeout(browserReadyCountdown);
        clearTimeout(browserDoneCountdown);



        // search array for disconnected client id and remove element
        // arrayClients.splice(statFunctions.searchArray(arrayClients, socket.id.toString(), 2), 1); 
        arrayClients.splice(tempId, 1); 


        //arrayStatistics.splice(statFunctions.searchArray(arrayStatistics, socket.data.clientname.toString(), 3), 1); // search statistics array for disconnected client id and remove element

        io.emit("activeclients", activeClients);


        if(ongoingCrawl==true && activeClients<config.num_clients){

            console.log("\x1b[31mERROR: " + "Client "+ socket.data.clientname + " disconnected while crawling...\nClient will automatically  try to reconnect.","\x1b[0m");

            lostConnection= true;
            
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
        //console.log(data);
    })

    socket.on("urldone", async (data) => {

        if (activeClients == config.num_clients && ongoingCrawl == true) {

            pendingJobs -= 1;
            //console.log(pendingJobs) //debug
            let dateUrlDone = Date.now();

            let statArrayPosition = helperFunctions.searchArray(arrayStatistics, socket.data.clientname.toString(), 1);;
            let calibrationArrayPosition =  helperFunctions.searchArray(arrayClients, socket.data.clientname.toString(), 1);

            
            if (calibrationDone == true) { // everytime one browser finished while crawling

                //inserting the time between distributing the url to receiving the signal that the browser finished into the statistics array
                arrayStatistics[statArrayPosition].doneArray.push((dateUrlDone - timeUrlSent));

                //inserting the time the browser waits before each website visit into the statistics
                tempWaitingTime = arrayClients[calibrationArrayPosition].waitMs;
                arrayStatistics[statArrayPosition].waitingTimeArray.push(tempWaitingTime);

                // insert time browser is done with the url
                if(!config.test_run) arrayStatistics[statArrayPosition].dateArray.push(new Date(dateUrlDone).toISOString());

                console.log("\x1b[34mCRAWLED:\x1b[0m", arrayClients[calibrationArrayPosition].workerName , "crawled URL", tempUrl , "finished\x1b[34m",
                (dateUrlDone - timeUrlSent) , "ms\x1b[0m after distribtung URL");
                              

            }else{ // everytime one browser is done in calibration                

                //console.log("inserting done" + (dateUrlDone - timeUrlSent) +" into " +arrayClients[calibrationArrayPosition].workerName ); //debug
                arrayClients[calibrationArrayPosition].doneArray.splice(testsDone, 0, (dateUrlDone - timeUrlSent)); //changed
                //arrayClients[calibrationArrayPosition].doneArray.push((dateUrlDone - timeUrlSent));

            }
            // todo nach readytimeout fehlt (wahrscheinlich immer beim ersten nein) das donearray in der calibration 
            // und der ausgetimte hat eins zu viel im donearray
            // das done vom ausgetimten kommt später noch rein und versaut mir die reihenfolge


            if (pendingJobs == 0 && calibrationDone == false) { // if all browser done the url in calibration

                var maxDelay = statFunctions.getMaxDelay(arrayClients, testsDone);

                // arrayClients.forEach(element => {

                //     maxDelay = statFunctions.getMaxDelay(arrayClients, testsDone);

                //     element.maxDelayArray.push(maxDelay);
                //     //console.log(element.delayArray[testsDone] +" = " + statFunctions.getMaxDelay(true, arrayClients, testsDone) + " nicht gleioch" +  statFunctions.getMaxDelay(true, arrayClients, testsDone-1))
                // });
                
                statFunctions.insertMaxDelay(arrayClients, maxDelay, testsDone);
                

                clearTimeout(browserDoneCountdown);
                logFunctions.logCalibration(arrayClients, testsDone);

                testsDone += 1;
                receivedRequests = 0;

                console.table(arrayClients);
                helperFunctions.checkArrayLengths(arrayClients, testsDone, false);

                //helperFunctions.checkArrayLengths(arrayClients, testsDone, false); //debug

                console.log("\x1b[33mSTATUS: \x1b[0m" + "Calibration #" + testsDone + " Delay between first and last HTTP Request ", "\x1b[33m", + statFunctions.getMaxDelay(arrayClients, testsDone-1) + " ms" , "\x1b[0m");


                if (testsDone == config.calibration_runs ) { // calibration iterations done
           
                    calibrationDone = true;
                    await sleep(4000);

                    calibration();

                    
                    if (initCalibrationDone == false) { 

                        let calibrationTookMs = Date.now() - calibrationTime;

                        console.log("INFO: " + "Calibration took " + Math.round(calibrationTookMs / 1000) + " seconds.");
                        console.log("INFO: " + "Average delay between first and last HTTP request from " + testsDone + " test runs is " +
                            // Math.round( acessDelay.reduce((a, b) => (a + b)) / acessDelay.length )
                            (arrayClients[arrayClients.length - 1].avgDelay - arrayClients[0].avgDelay) + " ms", "\x1b[0m");

                        // let estimatedCrawlTime = ((urlList.length/config.calibration_runs) * (Date.now() - calibrationTime)) + ((urlList.length / config.re_calibration) * calibrationTookMs);
                        // console.log("Estimated time to crawl "+ urlList.length + " websites is "+ estimatedCrawlTime+ "ms " + msToTime(estimatedCrawlTime)+ " hours.");
                        // changed
                        let estimatedCrawlTime = ((numIterations / config.calibration_runs) * calibrationTookMs) + ((numIterations / config.re_calibration) * calibrationTookMs);
                        console.log("INFO: " + "Estimated time to crawl " + numIterations + " websites is " + estimatedCrawlTime + "ms " + helperFunctions.msToHours(estimatedCrawlTime) + " hours.");
                        
  


                        //changed to no question
                        // isAnswered = false;
                        initCalibrationDone = true;
                        // interfaceQuestion("crawl");
                        //sendUrl(false); changed

                        // if (config.test_run) sendUrl(false); // changed umwandlung
                        // else sendUrl(false); 
                    }
                    // else{
                    //     testsDone= 0;
                    //     //sendUrl(false) changed
                    //     sendUrl(true);
                    // }
                    browsersReady = 0;
                    calibrationTime = 0;
                    testsDone= 0;
                    sendUrl(false); 

                }else{ // if calibration done else continue calibration
                    sendUrl(true);
                }


            }else if (pendingJobs == 0 && calibrationDone == true) { // if all browser done the url in normal crawl

                clearTimeout(browserDoneCountdown);
                doneTimeoutCounter = 0;
                urlsDone += 1;
                // get position of the worker in the statistics array
                // statArrayPosition = helperFunctions.searchArray(arrayStatistics, socket.data.clientname.toString(), 1);
                // arrayStatistics[statArrayPosition].maxDelayArray.push(statFunctions.getMaxDelay(arrayStatistics, urlsDone));
                // console.log("MAXDELAY "+statFunctions.getMaxDelay(arrayStatistics, urlsDone));
                // calculate max delay to other workers requests

                
                
                //helperFunctions.checkArrayLengths(arrayStatistics, urlsDone, true); //debug
                // console.table(arrayStatistics);



                if(config.test_run) { // calculate maximum delay in incoming http request for the testrun

                    statFunctions.insertMaxDelay(arrayStatistics, statFunctions.getMaxDelay(arrayStatistics, urlsDone-1), urlsDone-1);

                    statFunctions.calcHttpDelayV2(arrayStatistics, urlsDone);

                    logFunctions.logTesting(arrayStatistics, urlsDone);

                }
                else logFunctions.logCrawling(arrayStatistics,urlsDone, tempUrl.toString());
                
                console.log("\x1b[33mSTATUS: \x1b[0m" + "URL " + urlsDone , " of " , numIterations + " done");
                

                if( urlsDone == numIterations){

                    console.log("\x1b[33mSTATUS: \x1b[0m" + "All Websites crawled.\nShutting down server...", "\x1b[0m");
                    io.sockets.emit("close", "finished");
                    process.exit();

                } else if (urlsDone % config.re_calibration == 0) { // recalibrate after number of website crawled 

                    console.log("\x1b[33mSTATUS: \x1b[0m" + "\x1b[32m", "Starting recalibration...", "\x1b[0m")
                    calibrationDone = false;
                    statFunctions.flushCalibrationArray(arrayClients);
                    sendUrl(true); // begin recalibration

                } else {

                    //send url from urllist to all clients if end of urlList not reached
                    sendUrl(false); 
                }
            }

        }
    })


    socket.on("browserready", (data)=> {    // todo ich müsste wenn das ready reinkommt ob der browser schon ein ready hat und erst hochzählen wenn ein neuer ready ist
        // todo  wann ist es zulässig zu überschreiben und wann kommt in einer iteration das ready fälschlich zweimal rein
        // nur wenn browserdonetimeout
        // jetzt wird bei timeout ready = undefined also müsste eigentlich nicht mehr übershrieben werden


        //beim disconnect wo die ganze calibration nochmal gemacht wird ist die liste natürlich schon voll

        if (activeClients == config.num_clients && ongoingCrawl == true ) {

            let tempName = socket.data.clientname.toString();
           
            timeBrowserReady =  (Date.now() - timeUrlSent);

            if (browsersReady == 0) fastestReady = timeBrowserReady;
            if (browsersReady == config.num_clients-1) slowestReady = timeBrowserReady;


            //changed + browserready für clientarray //search arrays for right worker and push time it took for browser to start in the array
            if(calibrationDone==true){
                
                let arrayPosition = helperFunctions.searchArray(arrayStatistics, tempName, 1);

                // check if the browser ready signal is unique
                if(arrayStatistics[arrayPosition].readyArray.length == urlsDone){  //if entries in array matches iterations

                    arrayStatistics[arrayPosition].readyArray.push(timeBrowserReady);

                    //changed added readycheck
                    browsersReady += 1;
                    console.log("\x1b[33mSTATUS: \x1b[0m" + browsersReady + "/" + config.num_clients + " " + data + "'s browser ready");

                }else{
                    arrayStatistics[arrayPosition].readyArray[urlsDone] = timeBrowserReady;
                    console.log("overwriting ready status"); //debug
                    //changed added readycheck
                    console.log("\x1b[33mSTATUS: \x1b[0m" + browsersReady + "/" + config.num_clients + " " + data + "'s browser ready");

                }
                

            }else{
                let arrayPosition = helperFunctions.searchArray(arrayClients, tempName, 1);


                if(arrayClients[arrayPosition].readyArray.length == testsDone){  //if entries in array matches iterations 

                    arrayClients[arrayPosition].readyArray.push(timeBrowserReady);

                    browsersReady += 1;
                    console.log("\x1b[33mSTATUS: \x1b[0m" + browsersReady + "/" + config.num_clients + " " + data + "'s browser ready");

                }else{
                    arrayClients[arrayPosition].readyArray[testsDone] = timeBrowserReady;
                    console.log("overwriting ready status"); //debug

                    console.log("\x1b[33mSTATUS: \x1b[0m" + browsersReady + "/" + config.num_clients + " " + data + "'s browser ready");
                }

            }
        

            if (browsersReady == config.num_clients) { // if all workers signalized that their browser is ready

                timeAllBrowsersReady = Date.now();

                clearTimeout(browserReadyCountdown);


                console.log("INFO: " + "Delay compensated between first and last browser ready to visit website " + (slowestReady - fastestReady) + " ms");
                

                io.emit("browsergo"); // distribute signal to access the url after all browser are ready

                browserDoneCountdown = setTimeout(browserDoneTimeout, config.timeout_ms);
                browsersReady = 0;
            }
        }
    })

    function sendUrl(calibration){

        ongoingCrawl=true;
        pendingJobs = 0;
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
           
        }else{

            if(config.test_run) tempUrl =  "test";
            //else tempUrl = urlList[urlsDone].toString().split(',').pop();
            else {
                preTempUrl = urlList[urlsDone].toString();
                tempUrl = preTempUrl.slice(preTempUrl.indexOf(",") + 1);
            }


        }
        io.sockets.emit("url", tempUrl);
        timeUrlSent = Date.now();

        pendingJobs+=config.num_clients;

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
    function browserDoneTimeout(){

        let tempId;
        let tempName;

        if(doneTimeoutCounter == config.website_attempts) { // if browsers timed out 3 times at the current website the URL will be skipped

            urlsDone += 1;
            doneTimeoutCounter = 0;
            clearTimeout(browserDoneCountdown);

            io.sockets.emit("killchildprocess", "timeout");

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Skipping url#" + urlsDone + " " + tempUrl + " after failing to crawl " + (config.website_attempts+1) + " times.");
            logFunctions.skipUrl(tempUrl.toString(), urlsDone, new Date().toISOString());

            sendUrl(false);
            return;
        }
    
        if (calibrationDone == true && activeClients == config.num_clients) {
    
            arrayStatistics.forEach(element => {
    
                if (element.doneArray.length - 1 != urlsDone) { // check if a worker is missing an entry in the list where the time the browser is done is recorded
                    tempId = element.socketId;
                    tempName = element.workerName.toString();
    
                }
            });

            statFunctions.removeExtraStats(arrayStatistics,urlsDone, true); // remove the statistics from current iteration from all other workers so that the iteration can be repeated

    
            console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out while visiting URL...\nKilling all browsers.", "\x1b[0m");
            //io.to(tempId).emit("killchildprocess", "timeout");
            io.sockets.emit("killchildprocess", "timeout");

            doneTimeoutCounter += 1;

            console.log("\x1b[33mSTATUS: \x1b[0m" + "Resending url#" + (urlsDone+1) + " " + tempUrl + " to all workers.");
    
            sendUrl(false);
    
        }else if(activeClients == config.num_clients){
            arrayClients.forEach(element => {

                if(element.doneArray.length-1 != testsDone){
                    tempId = element.socketId;
                    tempName = element.workerName.toString();
                    
                }
                if (element.readyArray.length - 1 == testsDone){ // delete all other ready values
                    console.log("removed last element" +element.readyArray[testsDone-1] );

                    element.readyArray.pop();
                } 

            });
    
            statFunctions.removeExtraStats(arrayClients, testsDone, false);
            console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out at calibration while visiting URL...\nTrying to kill timed out browser.", "\x1b[0m");
            //io.to(tempId).emit("killchildprocess", "timeout");
            io.sockets.emit("killchildprocess", "timeout");

    
            console.log("\x1b[33mSTATUS: \x1b[0m" + "Restarting calibration#" + testsDone);
            sendUrl(true);
        }
    
        logFunctions.logTimeout(tempName, new Date().toISOString(), tempUrl.toString(), doneTimeoutCounter);    
    }

    process.on("SIGINT", function(){
        io.sockets.emit("killchildprocess", "cancel");
        //io.sockets.emit("close", "kill")
        console.log("\x1b[33mSTATUS: \x1b[0m" +"Aborting, closing all child processes on clients...");
        process.exit();
    });
    
})


function sleep(ms) {
    console.log("waiting")

    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

function browserReadyTimeout(){ // timeout if the browser ready signal ist not received within the timelimit 

    //BrowserDoneTimout wenn urldone nicht kommt- sigint an alle - gucken ob urlsdone schon hochgegangen ist und dann letzte url nochmal neu aber wie aufrufen?

    let tempId;
    let tempName;
    if(calibrationDone==true && activeClients == config.num_clients){

        arrayStatistics.forEach(element => { // search arrays for element who lacks the signal that the browser is ready

            if(element.readyArray.length-1 != urlsDone){
                tempId = element.socketId;
                tempName = element.workerName.toString();
      
            }
        });
    }else if(activeClients == config.num_clients){

        arrayClients.forEach(element => {
            //console.log(element.readyArray.length +" kleiner" + testsDone)
            if(element.readyArray.length-1 != testsDone){
                tempId = element.socketId;
                tempName = element.workerName.toString();
                
            }
        });
    }

    if (tempId != undefined) { // kill and restart timed out browser

        console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out while starting...\nTrying to kill childprocess.", "\x1b[0m");
        logFunctions.logTimeoutStarting(tempName, new Date().toISOString(), tempUrl.toString());

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
    // calculate average time gathered from the calibibration between sending url to receiving the http request
    for (var i = 0; i < arrayClients.length; i++) {

        arrayClients[i].avgDelay = Math.round(arrayClients[i].requestArray.reduce((a, b) => (a + b)) / arrayClients[i].requestArray.length);
    }

    arrayClients.sort(helperFunctions.dynamicSort("avgDelay"));


    for (let i = 0; i < arrayClients.length - 1; i++) {

        // calculate the difference between each worker to the slowest
        let timeToLast = arrayClients[arrayClients.length - 1].avgDelay - arrayClients[i].avgDelay;
        arrayClients[i].waitMs = timeToLast;

        //distribute the calculated time to wait before each website access to the clients
        io.to(arrayClients[i].socketId).emit("waitingtime", timeToLast);

        console.log("\x1b[33mSTATUS: \x1b[0m" + "Waiting time " + timeToLast + " ms delivered to " + arrayClients[i].workerName);
        
    }

    // flush http request times out of time array // todo checken was alles gelöscht wird. Muss avgDelay und waitMs auch gelöscht werden?
    for (let i = 0; i < arrayClients.length ; i++) {
        arrayClients[i].requestArray = []
    }

}

app.get('/', function (req, res) {

    if (activeClients == config.num_clients && ongoingCrawl == true) {

        let accessTime = Date.now(); 
        accesDate = new Date(accessTime).toISOString();

        tempUserAgent = req.get('user-agent').toString(); // identify the http request by setting the user-agent on the worker while calibrating

        let tempName;

        if(calibrationDone== false){

            let arrayPosition = helperFunctions.searchArray(arrayClients, tempUserAgent, 4);
            arrayClients[arrayPosition].requestArray.push((accessTime - timeUrlSent)); // milliseconds from sending url to client to receiving http request 

            //todo fehler cannot read timearray of undefined //feherfang wenn useragentnotset
            arrayClients[arrayPosition].dateArray.push(accesDate);
            tempName = arrayClients[arrayPosition].workerName;
        } 

        if(calibrationDone == true && config.test_run == true){

            let arrayPosition = helperFunctions.searchArray(arrayStatistics, tempUserAgent.toString(), 4);

            arrayStatistics[arrayPosition].requestArray.push((accessTime - timeUrlSent)); // milliseconds from sending url to client to receiving http request // old accessTime - timeAllBrowsersReady

 
            arrayStatistics[arrayPosition].dateArray.push(accesDate);
            tempName = arrayStatistics[arrayPosition].workerName;

        } 
        console.log("\x1b[34mREQUEST:\x1b[0m HTTP Request from " + tempName + " \x1b[34m" + (accessTime - timeUrlSent) + "\x1b[0m ms after starting iteration. " + (timeAllBrowsersReady - accessTime) 
        +" ms after sending ready signal");

        res.send('measuring browser access time!');

    }    
    

}); 

