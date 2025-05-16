const os = require('os');
const { execSync } = require('child_process');
const { dependencies } = require('../package.json');
const { activeConfig, activeWorker } = require('../config.js');

const fs = require('fs');
const path = require('path');


function gatherEnvironmentInfo(crawlerData) {

    // System Info
    const systemInfo = {
    osType: os.type(),
    osPlatform: os.platform(),
    osRelease: os.release(),
    osArch: os.arch(),
    cpu: os.cpus()[0].model,
    cpuCores: os.cpus().length,
    totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)} MB`,
    freeMemory: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
    };

    // Node.js Version
    const nodeInfo = {
    nodeVersion: process.version,
    };

    // npm dependencies and versions // todo versions all 1.0
    const npmDependencies = {};
    Object.keys(dependencies).forEach(dep => {
    npmDependencies[dep] = execSync(`npm list ${dep} --depth=0`).toString().split('@')[1].trim();
    });




    // Define the path to the VERSION file
    const versionFilePath = path.join(activeConfig.worker.script_path, 'VERSION');

    const crawlerInfo = {
        crawlerType: activeWorker,
        clientName: activeConfig.worker.client_name,
        headless: activeConfig.worker.headless,
        crawlerVersion: activeWorker === 'OpenWPM' ? readFileContent(versionFilePath) : 'Unknown' // todo find method for puppeteer
        // what browser would be nice
        // do not track einstellungen und sowas wäre stark
        // userAgent, language, screenWidth, screenHeight, devicePixelRatio

        // es gibt noch die openwpm specific sachen, die am anfang geprintet werden
    };

    //crawlerVersuin: activeConfig.activeWorker ? readFileContent(versionFilePath) // Retrieve the content from the VERSION file

    if (activeWorker === 'OpenWPM'){
        crawlerInfo.automation_framework_version = crawlerData.openwpm_version;
        crawlerInfo.browser_version = crawlerData.firefox_version;
        crawlerInfo.user_agent = crawlerData.user_agent;
    }


    const crawlSettings = {
        websiteStaytime: 0, // todo
        enableProxy: activeConfig.worker.enable_proxy,
        // stateful or stateless
        // maybe dns settings, custom dns
    };

    // Erfassung der Zeitstempel
    const timestamp = new Date().toISOString();

    let installedFonts = '';
    try {
    installedFonts = execSync('fc-list').toString().split('\n'); // Linux
    } catch (e) {
    installedFonts = "Font list not available on this OS";
    }

    const localeInfo = {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: Intl.DateTimeFormat().resolvedOptions().locale
    };

    // Zusammenführen aller Informationen
    const environmentInfo = {
    timestamp,
    crawlerInfo,
    crawlSettings,
    systemInfo,
    localeInfo,
    crawlerData, // puppeteer or openwpm specific data
    //installedFonts,
    nodeInfo,
    npmDependencies,
    };

    // browser profile sollte man vielleicht auch noch speichern für preferences und so


    // Function to read the entire content of a file
    function readFileContent(filePath) {
        try {
        return fs.readFileSync(filePath, 'utf8').trim();
        } catch (error) {
        console.error(`Error reading file at ${filePath}:`, error);
        return 'Unknown';
        }
    }

    // Write environment info to file
    const outputPath = path.join(activeConfig.worker.crawl_data_path, 'environment_info.txt');
    try {
        fs.writeFileSync(outputPath, JSON.stringify(environmentInfo, null, 2));
        console.log(`Environment info written to ${outputPath}`);
    } catch (error) {
        console.error('Error writing environment info to file:', error);
    }

    // console.log("Environment Info:", JSON.stringify(environmentInfo, null, 2));

}

module.exports = gatherEnvironmentInfo;
