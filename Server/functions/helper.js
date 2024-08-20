module.exports ={

    searchArray : function(myArray, myValue, myColumn) {

        for (var i = 0; i < myArray.length; i++) {

            if (myColumn == 1) {
                if (myArray[i].workerName === myValue) { // search for workerName
    
                    return i;
                }
            } else if (myColumn == 2) {
                if (myArray[i].socketId === myValue) { // search for socketId
    
                    return i;
                }
            }else if (myColumn == 3) {
    
                if (myArray[i].workerName === myValue) { // search for workerName return waitingTime
    
                    return myArray[i].waitMs;
                    
                }
            }else if (myColumn == 4) {
    
                if (myArray[i].workerName === myValue) { // search for workerName with errorcode
    
                    return i;
                    
                }if (i == myArray.length-1) {
                    console.log("");
                    console.log("\x1b[31mERROR: " + "Can't match HTTP-Request to worker! Make sure useragent is set to the workers name for calibration\x1b[0m");
                    process.exit;
                }
            }
            
            else if (i === myArray.length - 1) {
                console.log("No match between names of clients!");
                //process.exit;
            }
        }
    },


    msToHours : function (s) {

        var ms = s % 1000;
        s = (s - ms) / 1000;
        var secs = s % 60;
        s = (s - secs) / 60;
        var mins = s % 60;
        var hrs = (s - mins) / 60;
      
        //return hrs + ':' + mins + ':' + secs + '.' + ms;
        return hrs + ':' + mins;
    },

    checkArrayLengths : function (array, iterations, calibrationDone){

        array.forEach(element => {
            console.log("URLSDONE " + iterations +" dateArray " + element.dateArray.length +" readyArray " + element.readyArray.length  
            + " requestArray " + element.requestArray.length + " doneArray " + element.doneArray.length + " maxDelayArray "+ element.maxDelayArray.length);

            if(calibrationDone) console.log("waitingTimeArray " + element.waitingTimeArray.length);
        });
    },

    dynamicSort : function (property) { 
        return function (obj1,obj2) {
            return obj1[property] > obj2[property] ? 1
                : obj1[property] < obj2[property] ? -1 : 0;
        }
    },

    // Utility function for colored console messages
    logMessage : function (type, message) {
        const colors = {
            reset: "\x1b[0m",

            red: "\x1b[31m",
            error: "\x1b[31m", // red

            yellow: "\x1b[33m",
            status: "\x1b[33m", // yellow

            bgWhite: "\x1b[47m",
            debug: "\x1b[47m", // bgWhite

            blue: "\x1b[34m",
            magenta: "\x1b[35m",
            cyan: "\x1b[36m",
            white: "\x1b[37m",

        };

        // console.log((colors[color] || colors.white) + message + colors.reset);
        const typeColor = colors[type.toLowerCase()] || colors.info; // default to info color if type not found
        console.log(typeColor + type.toUpperCase() + ": " + colors.reset + message);
    }

}
