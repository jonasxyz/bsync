function createTimeoutHandlers(context) {
    return {


        // Handles timeouts when browsers do not finish in time
        browserDoneTimeout: function(alreadyClosed) {
            console.log("BrowserdoneTimeout triggered.."); // DEBUG
            // TODO check what happens if two browsers time out in the same iteration

            const { 
                io, config, arrayClients, arrayStatistics, 
                logFunctions, statFunctions, helperFunctions,
                calibrationDone, testsDone, urlsDone, tempUrl, initiate_crawler, sendUrl 
            } = context;

            let tempId;
            let tempName;
            let tempIterations;
            let tempArray;
            let doneTimeoutCounter = 0;

            calibrationDone ? (tempArray = arrayStatistics, tempIterations = 0) : (tempArray = arrayClients, tempIterations = testsDone);

            console.log("tempArray", tempArray); //debug

            // Check if any worker did not finish
            // Signal done or browser finished missing
            tempArray.forEach(element => {
                if (element.doneArray.length - 1 != tempIterations || element.browserFinishedArray.length - 1 != tempIterations) {
                    tempId = element.socketId;
                    tempName = element.workerName.toString();
                    console.log("Browser timed out: ", tempName);
                }
            });

            if(!alreadyClosed) {
                console.log("Killing browser", tempName);
                io.to(tempId).emit("killchildprocess", "timeout"); // changed to not kill proxy, just saving har file
                io.sockets.emit("savehar", tempName);
            }

            console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out while visiting URL...\nKilling all browsers.", "\x1b[0m");

            doneTimeoutCounter += 1;

            if(doneTimeoutCounter == config.website_attempts && calibrationDone == true) { // if browsers timed out configured times at the current website the URL will be skipped
                let urlsDoneValue = urlsDone;
                urlsDoneValue += 1;
                doneTimeoutCounter = 0;
                // clearTimeout(browserDoneCountdown); // Dies muss in der Hauptdatei erfolgen
                statFunctions.flushArray(arrayStatistics, true);

                logFunctions.logTimeout(tempName, new Date().toISOString(), doneTimeoutCounter, urlsDoneValue+1);

                console.log("\x1b[33mSTATUS: \x1b[0m" + "Skipping url#" + urlsDoneValue + " " + tempUrl + " after failing to crawl " + (config.website_attempts) + " times.");
                logFunctions.skipUrl(tempUrl.toString(), urlsDoneValue, new Date().toISOString());

                //sendUrl(false); 010325
                // return;
            }

            if (calibrationDone == false) {
                statFunctions.removeExtraStats(arrayClients, testsDone, false);
                console.log("\x1b[33mSTATUS: \x1b[0m" + "Restarting calibration#" + testsDone);
                //sendUrl(true);
                logFunctions.logTimeout(tempName, new Date().toISOString(), doneTimeoutCounter, testsDone);
            } else {
                statFunctions.flushArray(arrayStatistics, true);
                console.log("\x1b[33mSTATUS: \x1b[0m" + "Resending url#" + (urlsDone + 1) + " " + tempUrl + " to all workers.");
                //sendUrl(false); 010325
                logFunctions.logTimeout(tempName, new Date().toISOString(), doneTimeoutCounter, urlsDone+1);
            }

            // send initiate_crawler to timed out worker
            io.to(tempId).emit("initiate_crawler", false);

            //socket.emit("initiate_crawler");
            //logMessage("status", "Starting crawlers");

            console.log("initiate_crawler sent after browserDoneTimeout");
            return;
        },

        // Handles timeouts when browsers do not finish in time
        browserReadyTimeout: function() {
            const { 
                io, config, arrayClients, arrayStatistics, 
                logFunctions, calibrationDone, testsDone, tempUrl 
            } = context;

            let tempId;
            let tempName;
            let tempArray;
            let iterations = 0;
            let activeClients = arrayClients.length;

            calibrationDone ? (tempArray = arrayStatistics, iterations = 0) : (tempArray = arrayClients, iterations = testsDone);

            if(activeClients == config.num_clients) {
                tempArray.forEach(element => {
                    if(element.readyArray.length-1 != iterations) {
                        tempId = element.socketId;
                        tempName = element.workerName.toString();
                    }
                });
            }   

            if (tempId != undefined) { // kill and restart timed out browser
                console.log("\x1b[31mERROR: " + "Client " + tempName + " browser timed out while starting...\nTrying to kill childprocess.", "\x1b[0m");
                logFunctions.logTimeoutStarting(tempName, new Date().toISOString());

                io.to(tempId).emit("killchildprocess", "timeout");

                console.log("\x1b[33mSTATUS: \x1b[0m" + "Restarting timed out browser " + tempName);

                // browserReadyCountdown = setTimeout(browserReadyTimeout, 120000); // moved to main scheduler

                if (config.test_run) io.to(tempId).emit("url", "test");
                else io.to(tempId).emit("url", tempUrl);

                console.log("\x1b[33mSTATUS: \x1b[0m" + "Resending URL " + tempUrl + " to " + tempName);
            }
        }
    };
}

module.exports = createTimeoutHandlers;