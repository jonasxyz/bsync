/****************************************************************************
 * puppeteer_synced.js
 *
 * Puppeteer script for browser automation, integrated with the bsync synchronization
 * framework. Handles proxy settings, headless mode and remote commands for visiting URLs.
 * 
 * 
 ****************************************************************************/

const puppeteer = require('puppeteer-core');
const minimist = require('minimist');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config.js'); // Import config

const args = minimist(process.argv.slice(2));
// console.log("Parsed Arguments: ", args); // DEBUG

const proxyhost = args.proxyhost;
const proxyport = args.proxyport;
const headless = args.headless || false;
const datapath = args.datapath || null;
const reset = args.reset || false;
const browserprofilepath = args.browserprofilepath || null;

const workerConfig = config.activeConfig.worker;


let browser, page;
let userDataDir = datapath ? path.resolve(datapath) : null;

// If browser profile path is provided, use it instead of datapath
if (browserprofilepath && !datapath) {
    // Create unique profile directory within the provided browser profile path
    // userDataDir = path.join(browserprofilepath, `puppeteer_profile_${Date.now()}`);
    userDataDir = browserprofilepath; // Use the provided path directly
    console.log(`Using browser profile path: ${userDataDir}`);
}

async function launchBrowser() {
    const launchOptions = {
        headless: headless,
        ignoreHTTPSErrors: true,
        userDataDir: userDataDir,
        browser: 'firefox', 
        executablePath: workerConfig.browser_path,
        args: ["---start-fullscreen"].filter(Boolean),
        extraPrefsFirefox: {} // Initialisiere extraPrefsFirefox
    };

    if (proxyhost && proxyport) {
        console.log(`Set Firefox Proxy to ${proxyhost}:${proxyport}.`);
        launchOptions.extraPrefsFirefox = {
            'network.proxy.type': 1, 
            'network.proxy.http': proxyhost,
            'network.proxy.http_port': parseInt(proxyport),
            'network.proxy.ssl': proxyhost,
            'network.proxy.ssl_port': parseInt(proxyport),
            'network.proxy.share_proxy_settings': true 
        };
    }

    browser = await puppeteer.launch(launchOptions);

    // Use the already opened tab
    page = (await browser.pages())[0]; 
    
    // Todo unify screen size with other frameworks
    // Set the viewport to the maximum size
    // await page.setViewport({
    //     width: 1920,
    //     height: 1080,
    //     deviceScaleFactor: 1,
    // });
    
    // console.log("Browser launched");
    process.stdout.write("browser_ready");
}

async function visitUrl(url, waitingtime = 0, stayTime = 3, restart = false) {
    // if (useragent) {
    //     await page.setUserAgent(useragent);
    //     console.log(`Useragent set to ${useragent}`);
    // }

    if (waitingtime > 0) {
        console.log(`Waiting ${waitingtime} ms before visiting ${url}`);
        await new Promise(resolve => setTimeout(resolve, waitingtime));
    }

    console.log(`Visiting ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' }).catch(e => console.error("Error visiting URL: ", e)); // https://github.com/puppeteer/puppeteer/issues/4291
    console.log(`Staying on page for ${stayTime} seconds`);

    // Stay on site for stayTime
    await new Promise(resolve => setTimeout(resolve, stayTime * 1000));
    
    // Signalisiere, dass die URL-Verarbeitung abgeschlossen ist
    process.stdout.write("URL_DONE");

    if (restart) { // Korrigiert von 'reset' zu 'restart' basierend auf dem Funktionsparameter
        console.log("Restarting browser with profile reset");
        await resetBrowser(); 
    } else {

        // Navigate to about:blank to stop all processes
        console.log("\nNavigating to about:blank to stop all processes");
        await page.goto('about:blank', { waitUntil: 'load' }).catch(e => 
            console.error("Error navigating to about:blank:", e));
            
        // Wait for Network Idle
        //await page.waitForNetworkIdle({idleTime: 1000, timeout: 5000}).catch(e => console.error("Network idle timeout: ", e));

        // Open new tab
        // console.log("Opening new tab");
        // const newPage = await browser.newPage();
        
        // Save reference to the old tab
        // const oldPage = page;
        
        // Switch to the new tab
        // page = newPage;
        
        // Close the old tab after the new tab is active
        // console.log("Closing previous tab");
        // await oldPage.close().catch(e => console.error("Error closing tab:", e));

        // console.log("\nNavigating to about:blank");
        // await page.goto('about:blank');

        // Wait for 1 second for previous request to complete
        // await new Promise(resolve => setTimeout(resolve, 1000));

        //process.stdout.write("browser_ready");
    }

    console.log("Finished processing URL");
}

async function resetBrowser() {
    console.log("Resetting browser.");
    await browser.close();
    process.stdout.write("BROWSER_FINISHED");


    // If a user-defined data path is used, do not delete the directory
    if (!datapath && userDataDir) {
        try {
            if (fs.existsSync(userDataDir)) {
                // fs.rmSync(userDataDir, { recursive: true, force: true }); // Do not delete the profile directory
                // console.log(`Deleted profile directory: ${userDataDir}`);
                console.log(`Reusing profile directory: ${userDataDir}`);
            }
        } catch (err) {
            console.error("Error checking profile directory:", err);
        }
    }

    // If no user-defined data path is set, use a new temporary path
    // if (!datapath) {
    //     userDataDir = path.join(os.tmpdir(), `puppeteer_profile_${Date.now()}`);
    //     console.log(`Using new profile directory: ${userDataDir}`);
    // }

    await launchBrowser();
}

(async () => {
    await launchBrowser();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    // console.log("Listening for std.in commands."); // DEBUG

    rl.on('line', async (input) => {
        if (input.startsWith("visit_url")) {
            let command = input.substring("visit_url".length).trim(); // Remove space trimming
            let data = null;
            try {
                data = JSON.parse(command);
                //console.log("Parsed data: ", data); // DEBUG
            } catch (e) {
                console.error("Failed to parse input JSON: ", e);
                return;
            }
    
            const url = data.url;
            // const useragent = data.userAgent;
            const waitingtime = data.waitingtime || 0;
            const stayTime = data.stayTime || 3; 
            const restart = data.restart || false;
    
            if (url) {
                //console.log("useragent cor aiwati: ", useragent); // DEBUG
                await visitUrl(url, waitingtime, stayTime, restart).then(() => {
                    console.log("Finished visiting URL");

                    process.stdout.write("BROWSER_FINISHED");
                });
    
            } else {
                console.log("No valid URL provided.");
            }

        } else if (input === "check_readiness") {
            console.log("Browser ready status: ", browser.isConnected());
            process.stdout.write("browser_ready");

        } else if (input === "reset") {
            await resetBrowser();
            console.log("Browser reset done.");
        } else if (input === "exit") {
            console.log("Exiting");
            await browser.close();
            process.exit(0);
        } else {
            console.log("Unknown command:", input);
        }
    });
})();