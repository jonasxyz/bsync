const fs = require('fs');
var path = require('path');

var file = "";

// fs.writeFileSync("FILE.CSV", "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), REQUEST AFTER(MS), DONE AFTER(MS), MAX DELAY(MS)");

module.exports = {

    startLog : function (urlList, date) {

        file = "CRAWL_" + urlList.substr(0, urlList.lastIndexOf(".")) + date + ".csv";
        fs.writeFileSync(file, "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), ESTIMATED ACCESS AFTER(MS), ESTIMATED MAX DELAY(MS)");
    },
    startLogTesting : function (date) {

        file = "TESTCRAWL_" + date + ".csv";
        fs.writeFileSync(file, "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), REQUEST AFTER(MS), DONE AFTER(MS), MAX DELAY(MS)");
    },
    logTesting : function (array, urlsDone) {

        //var arrayField = urlsDone-1
        array.forEach(element => fs.appendFileSync(file, "\r\n" + "REQUEST" + ", " + "url#" + urlsDone + ", " + element.workerName+ ", " + element.dateArray[0] + ", " + element.readyArray[0]
        + ", " + element.waitingTimeArray[0] + ", " + element.requestArray[0] + ", " + element.doneArray[0] + ", " + element.maxDelayArray[0]));

    },
    logCalibration : function (array, iterations) {

        array.forEach(element => fs.appendFileSync(file, "\r\n" + "CALIBRATION" + ", " + "#" + iterations + "," + element.workerName+ "," + element.dateArray[iterations] + ", " + element.readyArray[iterations]
        + ", " + 0 + ", " +element.requestArray[iterations] + ", " + element.doneArray[iterations] + ", " + element.maxDelayArray[iterations]));
    },
    logCrawling : function (array, urlsDone) {

        //var arrayField = urlsDone-1
        array.forEach(element => fs.appendFileSync(file, "\r\n" + "CRAWLED" + ", " + "url#" + urlsDone + ", " + element.workerName+ ", " + element.dateArray[0] + ", " + element.readyArray[0]
        + ", " + element.waitingTimeArray[0] + ", " + element.requestArray[0] + ", " + element.doneArray[0] + ", " + element.maxDelayArray[0]));

    },
    logDisconnect : function(client, date) {
        fs.appendFileSync(file, "\r\n" + "ERROR" + ", " + "disconnect" + ", " + client + ", " + date);

    },
    logReconnect : function(client, date) {
        fs.appendFileSync(file, "\r\n" + "STATUS" + ", " + "reconnect" + ", " + client +", " + date);
        
    },
    logPing : function(client, date, ping) {
        fs.appendFileSync(file, "\r\n" + "STATUS" +", " + "ping" + ", " + client + ", " + date + ", " + ping);
        
    },
    logConnect : function(client, date) {
        fs.appendFileSync(file, "\r\n" + "STATUS" + ", " + "connected" + ", " + client + ", " + date);
        
    },
    logTimeoutStarting : function(client, date) {
        fs.appendFileSync(file, "\r\n" + "ERROR TIMEOUT" + ", " + "starting browser" + ", " + client + ", " + date);
        
    },
    logTimeout : function(client, date, doneTimeoutCounter, iterations) {
        fs.appendFileSync(file, "\r\n" + "ERROR TIMEOUT#" + doneTimeoutCounter + " visiting #" + iterations + ", " + client + ", " + date);
        
    },
    skipUrl : function(url, urlsDone, date) {
        fs.appendFileSync(file, "\r\n" + "STATUS SKIPURL" + ", " + "url#" + urlsDone + ", " + url + ", " + date) ;

    },

    // console error logs

    consoleError: function(message) {
        console.log("\x1b[31mERROR: " + message, "\x1b[0m");
    },
    consoleDebug(message) {
        console.log("\x1b[5mDEBUG: " + message, "\x1b[0m");
    },

};
