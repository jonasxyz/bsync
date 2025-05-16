const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const config = require('../config.js');
const { logMessage } = require('./helper.js');

var helperFunctions = require('./helper.js');



// function createServer(port) {
//     const app = express();
//     const server = app.listen(port, () => logMessage("status", 'Server listening on port ' + port + "\n"));
//     return server;
// }

// Create scheduler HTTP Server for calibration and uploading files
const app = express();
const server = app.listen(config.port, () => logMessage("status", 'Server listening on port ' + config.port + "\n"));


function createUrlSubdirectory(rootDirPath, tempUrl) {
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

function createClientUploadRoute(clientId, rootDirPath, tempUrl) {
    console.log("Creating upload route for client: " + clientId); //debug

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            createUrlSubdirectory(rootDirPath, tempUrl)
                .then(dirPath => cb(null, dirPath))
                .catch(err => cb(err));
        },
        filename: (req, file, cb) => {
            const uploadName = req.get('Client-Name');
            cb(null, uploadName + '_' + file.originalname);
        }
    });

    // Todo HTTP upload not used anymore, check and remove
    const upload = multer({ storage: storage });
    app.post(`/upload/${clientId}`, upload.single('file'), (req, res) => {
        console.log(`INFO: Receiving file upload at /upload/${clientId}`);

        if (!req.file) {
            console.error('No file uploaded');
            return res.status(400).send('No file uploaded');
        }

        const filePath = path.join(req.file.destination, req.file.filename);
        fs.writeFile(filePath, req.file.buffer, (err) => {
            if (err) {
                console.error('File save error:', err);
                res.status(500).send('File save failed');
            } else {
                console.log(`File saved successfully for client ${clientId}`);
                res.status(200).send('File saved successfully');
            }
        });
    });
}

function createClientSubpages(clientId, calibrationDone, arrayClients, arrayStatistics, timeUrlSent, timeAllBrowsersReady) { 
    //if (activeClients != config.num_clients) return;

    // TODO nicht sicher ob wenndie subpage bei der initialisier erstellt wird, auch noch später bei der req die timeurlsent daten usw. bekommt.
    app.get(`/client/${clientId}`, (req, res) => {

        //console.log("createClientSubpages triggered"); //debug
        console.log("Subpage created for client: " + clientId); //debug

        const accessTime = Date.now();
        const accesDate = new Date(accessTime).toISOString();

        let whichArray;

        calibrationDone ? (whichArray = arrayStatistics) : (whichArray = arrayClients);

        // Find the client's position in the array
        let arrayPosition = helperFunctions.searchArray(whichArray, clientId, 2);

        // Store timing information
        whichArray[arrayPosition].requestArray.push((accessTime - timeUrlSent));
        whichArray[arrayPosition].dateArray.push(accesDate);

        let tempName = whichArray[arrayPosition].workerName;

        res.status(200).send(`
                        
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
                measuring browser access time for client ${tempName}!
            </body>
            </html>
            
            `);

        // todo ist timeurl sent noch nötig? nicht mehr so unteschiedlich von allbrowsersready. Ja eigentlich schon wenn ein browser lang braucht zum ready werden
        console.log("\x1b[36mREQUEST:\x1b[0m HTTP Request from " + tempName + " \x1b[36m" + (accessTime - timeUrlSent) + "\x1b[0m ms after starting iteration. " , (accessTime - timeAllBrowsersReady )
        + " ms after sending browsergo signal");
    });

}
module.exports = {
    app,
    server,
    createClientUploadRoute,
    createClientSubpages,
    // createServer
};