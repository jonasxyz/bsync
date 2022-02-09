const fs = require('fs');
var file = "";

// fs.writeFileSync("FILE.CSV", "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), REQUEST AFTER(MS), DONE AFTER(MS), MAX DELAY(MS)");

module.exports ={

    startLog : function (urlList, date) {

        file = String(urlList) + "-crawl-" + date + ".CSV";
        fs.writeFileSync(file, "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), ESTIMATED ACCESS AFTER(MS), ESTIMATED MAX DELAY(MS)");
    },
    startLogTesting : function (date) {

        file = "testcrawl-" + date + ".CSV";
        fs.writeFileSync(file, "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), REQUEST AFTER(MS), DONE AFTER(MS), MAX DELAY(MS)");
    },
    logTesting : function (array, urlsDone, iterations) {

        var arrayField = urlsDone-1
        array.forEach(element => fs.appendFileSync(file, "\r\n"+"REQUEST" +", " +"url#" + urlsDone +", " + element.workerName+ ", " + element.dateArray[arrayField] + ", " + element.readyArray[arrayField]
        + ", " + element.waitingTimeArray[arrayField]+ ", " + element.requestArray[arrayField]+ ", " + element.doneArray[arrayField] + ", " + element.maxDelayArray[arrayField]));

    },
    logCalibration : function (array, iterations) {

        array.forEach(element => fs.appendFileSync(file, "\r\n"+"CALIBRATION" +", " + "#" + iterations + ","+ element.workerName+ "," + element.dateArray[iterations] + ", " + element.readyArray[iterations]
        + ", " + 0 + ", " +element.requestArray[iterations] + ", " + element.doneArray[iterations] + ", " + element.maxDelayArray[iterations]));
    },
    logCrawling : function (array, urlsDone, url) {

        var arrayField = urlsDone-1
        array.forEach(element => fs.appendFileSync(file, "\r\n"+"CRAWLED" +", " +"url#" + urlsDone + ", " + element.workerName+ ", " + element.dateArray[arrayField] + ", " + element.readyArray[arrayField]
        + ", " + element.waitingTimeArray[arrayField]+ ", " + "0" + ", " + element.doneArray[arrayField]));

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
        fs.appendFileSync(file, "\r\n"+"ERROR TIMEOUT#" + doneTimeoutCounter + " visiting #" + iterations +", " + client +", " + date);
        
    },
    skipUrl : function(url, urlsDone, date){
        fs.appendFileSync(file, "\r\n"+"STATUS SKIPURL" +", " +"url#" + urlsDone + ", " + url + ", " + date) ;

    }
}