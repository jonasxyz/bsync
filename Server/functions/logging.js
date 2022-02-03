const fs = require('fs');

fs.writeFileSync("FILE.CSV", "STATUS, ITERATION, CLIENT, DATE, READY AFTER(MS), WATINGTIME(MS), REQUEST AFTER(MS), DONE AFTER(MS), MAX DELAY(MS)");

module.exports ={

    logTesting : function (array, urlsDone, iterations) {

        var arrayField = urlsDone-1
        array.forEach(element => fs.appendFileSync("FILE.CSV", "\r\n"+"REQUEST" +", " +"url#" + urlsDone +", " + element.workerName+ ", " + element.dateArray[arrayField] + ", " + element.readyArray[arrayField]
        + ", " + element.waitingTimeArray[arrayField]+ ", " + element.requestArray[arrayField]+ ", " + element.doneArray[arrayField] + ", " + element.maxDelayArray[arrayField]));

    },
    logCalibration : function (array, iterations) {

        array.forEach(element => fs.appendFileSync("FILE.CSV", "\r\n"+"CALIBRATION" +", " +"calibration#"+iterations+","+ element.workerName+ "," + element.dateArray[iterations] + ", " + element.readyArray[iterations]
        + ", " + 0 + ", " +element.requestArray[iterations] + ", " + element.doneArray[iterations] + ", " + element.maxDelayArray[iterations]));
    },
    logCrawling : function (array, urlsDone, url) {

        var arrayField = urlsDone-1
        array.forEach(element => fs.appendFileSync("FILE.CSV", "\r\n"+"CRAWLED" +", " +"url#" + urlsDone +", " + element.workerName+ ", " + element.dateArray[arrayField] + ", " + element.readyArray[arrayField]
        + ", " + element.waitingTimeArray[arrayField]+ ", " + "0" + ", " + element.doneArray[arrayField]+ ", " + url));

    },
    logDisconnect : function(client, date){
        fs.appendFileSync("FILE.CSV", "\r\n"+"ERROR" +", " + "disconnect" +", " + client +", " + date);
        
    },
    logReconnect : function(client, date){
        fs.appendFileSync("FILE.CSV", "\r\n"+"STATUS" +", " + "reconnect" +", " + client +", " + date);
        
    },
    logPing : function(client, date, ping){
        fs.appendFileSync("FILE.CSV", "\r\n"+"STATUS" +", " + "ping" +", " + client +", " + date+", " + ping);
        
    },
    logConnect : function(client, date){
        fs.appendFileSync("FILE.CSV", "\r\n"+"STATUS" +", " + "connected" +", " + client +", " + date);
        
    },
    logTimeoutStarting : function(client, date, url){
        fs.appendFileSync("FILE.CSV", "\r\n"+"ERROR" +", " + "timeout" +", "+ "starting browser" +", " + client +", " + date +", " + url);
        
    },
    logTimeout : function(client, date, url, doneTimeoutCounter){
        fs.appendFileSync("FILE.CSV", "\r\n"+"ERROR" +", " + "timeout#" + doneTimeoutCounter + " while visiting" +", " + client +", " + date +", " + url);
        
    },
    skipUrl : function(url, urlsDone, date){
        fs.appendFileSync("FILE.CSV", "\r\n"+"ERROR" +", " + "skipping" +"url#" + urlsDone + ", " + date + ", " + url);

    }
}