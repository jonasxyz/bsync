const fs = require('fs');
var path = require('path');

var file = "";

// fs.writeFileSync("FILE.CSV", "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), REQUEST AFTER(MS), DONE AFTER(MS), MAX DELAY(MS)");

module.exports ={

    startLog : function (urlList, date, storagePath) {
        // Extract just the filename from the URL list path, removing any directory separators
        const urlListFilename = path.basename(urlList, path.extname(urlList));
        
        file = path.join(storagePath, "CRAWL_" + urlListFilename + "_" + date + ".csv");
        try {
            fs.writeFileSync(file, "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), REQUEST AFTER(MS), ITERATION_DONE AFTER(MS), MAX DELAY(MS)");
        } catch (error) {
            console.error("\x1b[31mERROR: " + "Error accessing storage path for writing log file:", "\x1b[0m");
            console.error(error);

        }
    },
    startLogTesting : function (date, storagePath) {

        file = path.join(storagePath, "TESTCRAWL_" + date + ".csv");
        try {
            fs.writeFileSync(file, "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), REQUEST AFTER(MS), ITERATION_DONE AFTER(MS), MAX DELAY(MS)");
        } catch (error) {
            console.error("\x1b[31mERROR: " + "Error accessing storage path for writing test log file:", "\x1b[0m");
            console.error(error);
        }
    },
    logTesting : function (array, urlsDone) {

        //var arrayField = urlsDone-1
        array.forEach(element => fs.appendFileSync(file, "\r\n"+"REQUEST" +", " +"url#" + urlsDone +", " + element.workerName+ ", " + element.dateArray[0] + ", " + element.readyArray[0]
        + ", " + element.waitingTimeArray[0]+ ", " + element.requestArray[0]+ ", " + element.browserFinishedArray[0] + ", " + element.maxDelayArray[0]));

    },
    logCalibration : function (array, iterations) {

        array.forEach(element => fs.appendFileSync(file, "\r\n"+"CALIBRATION" +", " + "#" + (iterations+1) + ","+ element.workerName+ "," + element.dateArray[iterations] + ", " + element.readyArray[iterations]
        + ", " + 0 + ", " +element.requestArray[iterations] + ", " + element.browserFinishedArray[iterations] + ", " + element.maxDelayArray[iterations]));
    },
    logCrawling2 : function (array, urlsDone) {

        //var arrayField = urlsDone-1
        array.forEach(element => fs.appendFileSync(file, "\r\n"+"CRAWLED" +", " +"url#" + urlsDone + ", " + element.workerName+ ", " + element.dateArray[0] + ", " + element.readyArray[0]
        + ", " + element.waitingTimeArray[0]+ ", " + element.requestArray[0] + ", " + element.doneArray[0] + ", " + element.maxDelayArray[0]  + ", " + element.errorArray[0]));

    },
    logCrawling: function (array, urlsDone) {
        array.forEach(element => {
            let logMessage = "\r\n" + "CRAWLED" + ", " + "url#" + urlsDone + ", " + element.workerName + ", " + element.dateArray[0] + ", " + element.readyArray[0]
                + ", " + element.waitingTimeArray[0] + ", " + element.requestArray[0] + ", " + element.browserFinishedArray[0] + ", " + element.maxDelayArray[0];
    
                if (element.errorArray && element.errorArray.length > 0) {
                    logMessage += ", " + element.errorArray[0];
                }
    
            fs.appendFileSync(file, logMessage);
        });
    },
    logDisconnect : function(client, date){
        fs.appendFileSync(file, "\r\n"+"ERROR" +", " + "disconnect" +", " + client +", " + date);
        
    },
    logReconnect : function(client, date){
        fs.appendFileSync(file, "\r\n"+"STATUS" +", " + "reconnect" +", " + client +", " + date);
        
    },
    logPing : function(client, date, ping){
        fs.appendFileSync(file, "\r\n"+"STATUS" +", " + "ping" +", " + client +", " + date+", " + ping);
        
    },
    logConnect : function(client, date){
        fs.appendFileSync(file, "\r\n"+"STATUS" +", " + "connected" +", " + client +", " + date);
        
    },
    logTimeoutStarting : function(client, date){
        fs.appendFileSync(file, "\r\n"+"ERROR TIMEOUT" + ", " + "starting browser" +", " + client +", " + date);
        
    },
    logTimeout : function(client, date, doneTimeoutCounter, iterations){
        fs.appendFileSync(file, "\r\n"+"ERROR TIMEOUT#" + doneTimeoutCounter + " visiting #" + iterations + ", " + client + ", " + date);
        
    },
    skipUrl : function(url, urlsDone, date){
        fs.appendFileSync(file, "\r\n"+"SKIPURL" +", " +"url#" + urlsDone + ", " + url + ", " + date) ;

    },
    newUrl : function(url, urlsDone, date){
        fs.appendFileSync(file, "\r\n"+"NEXTURL" +", " +"url#" + urlsDone + " " + url +  ", " +  ", " + date) ;

    }
}