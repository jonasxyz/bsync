const prompt = require('prompt');
const fs = require('fs');
const path = require('path');
const util = require('util');

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
    },

    getUserConfirmation : function (operation, callback) {
        prompt.message = '';
        prompt.start();
        prompt.get({
            properties: {
                confirm: {
                    // allow yes, no, y, n, YES, NO, Y, N as answer
                    pattern: /^(yes|no|y|n)$/gi,
                    description: `\nDo you want to start the ${operation} ? (y/n)\n`,
                    message: 'Type yes/no',
                    required: true,
                    default: 'yes'
                }
            }
        }, function (err, result) {
            if (err) {
                callback(err, null);
                return;
            }
            callback(null, result.confirm.toLowerCase());
        });
    }

}

/**
 * Sets up console and file logging.
 * Overrides console methods to write to both terminal and a log file.
 * @param {string} logDirectory - The directory where the log file should be stored.
 * @param {string} logFileName - The name of the log file.
 */
function setupConsoleAndFileLogging(logDirectory, logFileName) {
    const logFilePath = path.join(logDirectory, logFileName);

    // Ensure log directory exists
    if (!fs.existsSync(logDirectory)) {
        try {
            fs.mkdirSync(logDirectory, { recursive: true });
        } catch (err) {
            // Fallback to original console if directory creation fails
            console.error('Failed to create log directory:', err);
            return;
        }
    }

    const logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });

    const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug,
    };

    function formatLogMessage(level, args) {
        const timestamp = new Date().toISOString();
        // Convert all arguments to strings
        const messageParts = Array.from(args).map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    // Attempt to stringify objects, handle circular references if any (though util.format might handle this)
                    return util.format(arg); // util.format handles objects better than JSON.stringify for logging
                } catch (e) {
                    return '[Unserializable Object]';
                }
            } else if (arg === undefined) {
                return 'undefined';
            }
            return String(arg); // Ensure everything else is a string
        });
        const message = messageParts.join(' ');
        return `${timestamp} [${level.toUpperCase()}] ${message}\n`;
    }

    console.log = (...args) => {
        originalConsole.log.apply(null, args);
        logFileStream.write(formatLogMessage('log', args));
    };

    console.error = (...args) => {
        originalConsole.error.apply(null, args);
        logFileStream.write(formatLogMessage('error', args));
    };

    console.warn = (...args) => {
        originalConsole.warn.apply(null, args);
        logFileStream.write(formatLogMessage('warn', args));
    };

    console.info = (...args) => {
        originalConsole.info.apply(null, args);
        logFileStream.write(formatLogMessage('info', args));
    };

    console.debug = (...args) => {
        originalConsole.debug.apply(null, args);
        logFileStream.write(formatLogMessage('debug', args));
    };

    // Handle process exit to close the stream
    process.on('exit', () => {
        logFileStream.end();
    });
    process.on('SIGINT', () => {
        logFileStream.end();
        process.exit();
    });
    process.on('SIGTERM', () => {
        logFileStream.end();
        process.exit();
    });
    process.on('uncaughtException', (err) => {
      const errorMessage = formatLogMessage('error', ['Uncaught Exception:', err]);
      logFileStream.write(errorMessage, () => {
        // Ensure the error is written before exiting
        originalConsole.error('Uncaught Exception:', err);
        process.exit(1);
      });
    });

    console.log('Console and file logging initiated. Log file:', logFilePath);
}

module.exports.setupConsoleAndFileLogging = setupConsoleAndFileLogging;
