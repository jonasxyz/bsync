const puppeteer = require('puppeteer');
const minimist = require('minimist');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = minimist(process.argv.slice(2));
// console.log("Parsed Arguments: ", args); // DEBUG

const proxyhost = args.proxyhost;
const proxyport = args.proxyport;
const headless = args.headless || false;
const datapath = args.datapath || null;
const reset = args.reset || false;


let browser, page;
let userDataDir = datapath ? path.resolve(datapath) : null;

async function launchBrowser() {
    let proxyArg = '';

    if (proxyhost && proxyport) {
        proxyArg = `--proxy-server=${proxyhost}:${proxyport}`;
        console.log(`Proxy set to ${proxyhost}:${proxyport}`);
    }

    browser = await puppeteer.launch({
        headless: headless,
        ignoreHTTPSErrors: true,
        userDataDir: userDataDir, 
        //product: 'firefox', // WebDriver BiDi is used by default.
        args:
            [proxyArg].filter(Boolean),
            // "--start-maximized" todo funktioniert nur wenn proxyArg nicht da ist
        
    });

    // page = await browser.newPage();
    page = (await browser.pages())[0]; // Use the already opened tab
    // console.log("Browser launched");
    process.stdout.write("browser_ready");

}

async function visitUrl(url, useragent, waitingtime = 0, stayTime = 3, restart = false) {
    if (useragent) {
        await page.setUserAgent(useragent);
        console.log(`Useragent set to ${useragent}`);
    }

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

        // Navigiere zu about:blank, um alle laufenden Prozesse zu stoppen
        console.log("\nNavigating to about:blank to stop all processes");
        await page.goto('about:blank', { waitUntil: 'load' }).catch(e => 
            console.error("Error navigating to about:blank:", e));
            
        // Warte auf Network Idle
        //await page.waitForNetworkIdle({idleTime: 1000, timeout: 5000}).catch(e => console.error("Network idle timeout: ", e));

        // Öffne einen neuen Tab
        // console.log("Opening new tab");
        // const newPage = await browser.newPage();
        
        // Speichere Referenz auf den alten Tab
        // const oldPage = page;
        
        // Wechsle zum neuen Tab
        // page = newPage;
        
        // Schließe den alten Tab erst nachdem der neue Tab aktiv ist
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


    // Wenn ein benutzerdefinierter Datenpfad verwendet wird, das Verzeichnis nicht löschen
    if (!datapath && userDataDir) {
        try {
            if (fs.existsSync(userDataDir)) {
                fs.rmSync(userDataDir, { recursive: true, force: true });
                console.log(`Deleted profile directory: ${userDataDir}`);
            }
        } catch (err) {
            console.error("Error deleting profile directory:", err);
        }
    }

    // Falls kein benutzerdefinierter Datenpfad gesetzt wurde, verwende einen neuen temporären Pfad
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
            const useragent = data.userAgent;
            const waitingtime = data.waitingtime || 0;
            const stayTime = data.stayTime || 3; 
            const restart = data.restart || false;
    
            if (url) {
                //console.log("useragent cor aiwati: ", useragent); // DEBUG
                await visitUrl(url, useragent, waitingtime, stayTime, restart).then(() => {
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
