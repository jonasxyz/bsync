const puppeteer = require('puppeteer');
const minimist = require('minimist');

// DEBUG spawn string: node puppeteer_synced --proxyhost 127.0.0.1 --proxyport 8080 --waitingtime 50

const args = minimist(process.argv.slice(2));

console.log("Parsed Arguments: ", args); // DEBUG

const url = args.url;
const proxyhost = args.proxyhost;
const proxyport = args.proxyport;
const useragent = args.useragent;
//const waitingtime = parseInt(args.waitingtime, 10) || 0;
const waitingtime = args.waitingtime;

const headless = args.headless || false;

console.log(`proxyhost: ${proxyhost}`); // DEBUG
console.log(`proxyport: ${proxyport}`);

let proxyArg = '';

if (proxyhost && proxyport) {
    proxyArg = `--proxy-server=${proxyhost}:${proxyport}`;
    console.log(`Proxy set to ${proxyhost}:${proxyport}`); //this should get printed
} else {
    console.log("Proxy not set. proxyhost or proxyport missing");
}

(async () => {
    const browser = await puppeteer.launch({
        headless: headless,
        ignoreHTTPSErrors: true,
        args: [proxyArg].filter(Boolean)
    });

    const page = await browser.newPage();

    if (useragent) {
        await page.setUserAgent(useragent);
        console.log(`Useragent set to ${useragent}`);
    }

    // Send signal that browser is ready for visiting website
    process.stdout.write("browserready");

    process.stdin.on("data", async (data) => {
        if (data.toString().includes("visiturl")) {
            console.log("All browsers ready");

            if (waitingtime > 0) {
                console.log(`waiting ${waitingtime} s`);
                await new Promise(resolve => setTimeout(resolve, waitingtime*1000));
            }

            console.log(`visiting ${url}`);
            await page.goto(url);

            await waitOnSite(3);

            await browser.close();

            process.stdout.write("urldone");

            process.exit();
        }
    });

})();

function waitOnSite(s){
    return new Promise(resolve => setTimeout(resolve,s*1000));
}