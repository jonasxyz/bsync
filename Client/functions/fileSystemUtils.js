const fs = require('fs');
const path = require('path');
// const config = require("../config.js"); // Removed to allow dependency injection
const util = require('util'); // For formatting log messages

let workerConfig;
let baseConfig;

// Helper function for colored console output
const colors = {
    reset: "\x1b[0m",
    fg: {
        black: "\x1b[30m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
        gray: "\x1b[90m"
    }
};

function colorize(text, color) {
    return colors.fg[color] + text + colors.reset;
}

let crawlDir; // Stores the path to the main directory for the current crawl (e.g., /path/to/hars/Crawl_YYYY-MM-DD_HH-MM-SS)
let crawlDirTimestampExternal; // Stores the timestamp for the current crawl directory, set by createDir
let dirCreated = false; // Flag to indicate if the main crawl directory has been created

// Subdirectory names
const URLS_SUBDIR = 'urls';
const PROFILES_SUBDIR = 'profiles';
const LOGS_SUBDIR = 'logs';
const OPENWPM_DATA_SUBDIR = 'openwpm_data';

// const workerConfig = config.activeConfig.worker; // Removed
// const baseConfig = config.activeConfig.base; // Removed

/**
 * Initializes the file system utility module with the correct configuration.
 * This must be called before any other function in this module.
 * @param {object} passedConfig - The configuration object from worker.js.
 */
function init(passedConfig) {
    if (!passedConfig || !passedConfig.activeConfig || !passedConfig.activeConfig.worker || !passedConfig.activeConfig.base) {
        console.error(colorize("ERROR:", "red") + " fileSystemUtils init received an invalid configuration object.");
        // Exit or throw error because without config, nothing will work correctly
        process.exit(1);
    }
    workerConfig = passedConfig.activeConfig.worker;
    baseConfig = passedConfig.activeConfig.base;
}

/**
 * Formats a URL index into a string with leading zeros.
 * The number of leading zeros depends on the total number of URLs.
 * @param {number} index - The URL index (expected to be 1-based for formatting).
 * @param {number} totalUrls - The total number of URLs in the crawl list.
 * @returns {string} - The formatted URL index string.
 */
function formatUrlIndex(index, totalUrls) {
    if (typeof index !== 'number' || index < 1 || typeof totalUrls !== 'number' || totalUrls < 1) {
        // Fallback if formatting fails or parameters are invalid
        return 'idx' + index; 
    }
    const minLength = String(totalUrls).length;
    return String(index).padStart(minLength, '0');
}

/**
 * Check if path ends with a slash and add if not
 * @param {string} str - Path string
 * @returns {string} - Path string ending with a slash
 */
function checkBackslash(str) {
    if (str.endsWith('/')) {
        return str;
    } else {
        return str + '/';
    }
}

/**
 * Replace all characters that could be problematic in file paths
 * @param {string} str - Input string
 * @returns {string} - Sanitized string for use in file paths
 */
function replaceDotWithUnderscore(str) {
    return str.replace(/\//g, '-').replace(/[\.:?&=]/g, '_');
}

/**
 * Utility function to format file sizes in human readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} - Formatted size string
 */
function prettySize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Create directory to store generated files for current crawl.
 * Main structure: [har_destination]/[Crawl_Timestamp]/
 * Subdirectories: urls/, profiles/, logs/
 * @param {string} timestampFromWorker - Timestamp string for the crawl directory name
 * @returns {Promise<string>} - Promise resolving with the path to the created main crawl directory
 */
async function createDir(timestampFromWorker) {
    return new Promise((resolve, reject) => {
        crawlDirTimestampExternal = timestampFromWorker;
        // Main crawl directory, e.g., /path/to/hars/Crawl_YYYY-MM-DD_HH-MM-SS
        const baseCrawlPath = checkBackslash(workerConfig.har_destination) + crawlDirTimestampExternal;

        // Create main crawl directory
        fs.mkdir(baseCrawlPath, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red"), `Error creating base crawl directory ${baseCrawlPath}:`, err);
                return reject(err);
            }
            console.log(colorize("STATUS:", "green") + ` Created base crawl directory: ${baseCrawlPath}`);
            crawlDir = baseCrawlPath; // Set crawlDir to the main timestamped directory

            // Create subdirectories: urls, profiles, logs
            const subdirsToCreate = [
                path.join(baseCrawlPath, URLS_SUBDIR),
                path.join(baseCrawlPath, PROFILES_SUBDIR),
                path.join(baseCrawlPath, LOGS_SUBDIR),
                path.join(baseCrawlPath, OPENWPM_DATA_SUBDIR)
            ];

            Promise.all(subdirsToCreate.map(subdir => 
                fs.promises.mkdir(subdir, { recursive: true })
            ))
            .then(() => {
                dirCreated = true;
                console.log(colorize("STATUS:", "green") + ` Created subdirectories (urls, profiles, logs, openwpm_data) in: ${baseCrawlPath}`);
                resolve(baseCrawlPath); // Resolve with the main crawl path
            })
            .catch(subdirErr => {
                console.error(colorize("ERROR:", "red"), `Error creating subdirectories in ${baseCrawlPath}:`, subdirErr);
                reject(subdirErr);
            });
        });
    });
}

/**
 * Create directory for each crawled URL within the main crawl directory's "urls" subfolder.
 * HAR files will be stored directly here.
 * Local structure: [Haupt-Crawl-Ordner]/urls/[urlIndex]_[sanitized_url]/
 * @param {string} clearUrl - The sanitized URL string used for the directory name
 * @param {number} urlIndex - The 1-based index of the URL.
 * @param {number} totalUrls - The total number of URLs for formatting the index.
 * @returns {Promise<string>} - Promise resolving with the path to the created URL-specific directory
 */
async function createUrlDir(clearUrl, urlIndex, totalUrls) {
    if (!crawlDir) {
        const errMsg = "crawlDir not set. Call createDir first before creating a URL directory.";
        console.error(colorize("ERROR:", "red") + errMsg);
        return Promise.reject(new Error(errMsg));
    }
    const formattedIndex = formatUrlIndex(urlIndex, totalUrls);
    let urlSaveName = `${formattedIndex}_${replaceDotWithUnderscore(clearUrl)}`;
    // Path: [Haupt-Crawl-Ordner]/urls/[urlIndex]_[sanitized_url]/
    const localUrlSaveDir = path.join(crawlDir, URLS_SUBDIR, urlSaveName, "/"); // Ensure trailing slash

    return new Promise((resolve, reject) => {
        fs.mkdir(localUrlSaveDir, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red") + " ERROR creating local URL directory:", err);
                reject(err);
            } else {
                console.log(colorize("INFO:", "gray") + " Local URL directory created:", localUrlSaveDir);
                resolve(localUrlSaveDir);
            }
        });
    });
}

/**
 * Create directory for each crawled URL on an NFS server.
 * NFS structure: [NFS_Pfad]/[Crawl_Timestamp]/visited_urls/[urlIndex]_[sanitized_url]/[client_name]/
 * @param {string} clearUrl - The sanitized URL string used for the directory name
 * @param {number} urlIndex - The 1-based index of the URL.
 * @param {number} totalUrls - The total number of URLs for formatting the index.
 * @returns {Promise<string>} - Promise resolving with the path to the created remote directory
 */
async function createRemoteUrlDir(clearUrl, urlIndex, totalUrls) {
    if (!crawlDirTimestampExternal) {
        const errMsg = "crawlDirTimestampExternal not set. Call createDir first before creating a remote URL directory.";
        console.error(colorize("ERROR:", "red") + errMsg);
        return Promise.reject(new Error(errMsg));
    }
    return new Promise((resolve, reject) => {
        const formattedIndex = formatUrlIndex(urlIndex, totalUrls);
        let urlSaveName = `${formattedIndex}_${replaceDotWithUnderscore(clearUrl)}`;
        // Structure: [NFS_Pfad]/[Crawl_Timestamp]/visited_urls/[urlIndex]_[sanitized_url]/[client_name]/
        let remoteUrlDirPath = path.join(
            baseConfig.nfs_server_path, 
            crawlDirTimestampExternal, 
            "visited_urls", 
            urlSaveName, 
            workerConfig.client_name,
            "/" // Ensure trailing slash
        );
        
        fs.mkdir(remoteUrlDirPath, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red") + " Error creating remote URL directory:", err);
                reject(err);
            } else {
                console.log(colorize("STATUS:", "green") + " Created remote URL directory: " + remoteUrlDirPath);
                resolve(remoteUrlDirPath);
            }
        });
    });
}

/**
 * Create browser profile directory for the current worker.
 * Local structure: [Haupt-Crawl-Ordner]/profiles/[client_name]/
 * @returns {Promise<string>} - Promise resolving with the path to the created browser profile directory
 */
async function createBrowserProfileDir() {
    if (!crawlDir) {
        const errMsg = "crawlDir not set. Call createDir first before creating a browser profile directory.";
        console.error(colorize("ERROR:", "red") + errMsg);
        return Promise.reject(new Error(errMsg));
    }
    return new Promise((resolve, reject) => {
        // Path: [Haupt-Crawl-Ordner]/profiles/[client_name]/
        const localProfilePath = path.join(crawlDir, PROFILES_SUBDIR, workerConfig.client_name, "/"); // Ensure trailing slash
        
        fs.mkdir(localProfilePath, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red") + " Error creating local browser profile directory:", err);
                reject(err);
            } else {
                console.log(colorize("STATUS:", "green") + " Created local browser profile directory:", localProfilePath);
                resolve(localProfilePath);
            }
        });
    });
}

/**
 * Create browser profile directory for the current worker on an NFS server.
 * NFS structure: [NFS_Pfad]/[Crawl_Timestamp]/browser_profiles/[client_name]/
 * @returns {Promise<string>} - Promise resolving with the path to the created remote browser profile directory
 */
async function createRemoteProfileDir() {
    if (!crawlDirTimestampExternal) {
        const errMsg = "crawlDirTimestampExternal not set. Call createDir first before creating a remote profile directory.";
        console.error(colorize("ERROR:", "red") + errMsg);
        return Promise.reject(new Error(errMsg));
    }
    return new Promise((resolve, reject) => {
        // Path: [NFS_Pfad]/[Crawl_Timestamp]/browser_profiles/[client_name]/
        let remoteProfilePath = path.join(
            baseConfig.nfs_server_path,
            crawlDirTimestampExternal,
            "browser_profiles", 
            workerConfig.client_name,
            "/" // Ensure trailing slash
        );

        fs.mkdir(remoteProfilePath, { recursive: true }, (err) => {
            if (err) {
                console.error(colorize("ERROR:", "red") + " Error creating remote profile directory:", err);
                reject(err);
            } else {
                console.log(colorize("STATUS:", "green") + " Created remote profile directory: " + remoteProfilePath);
                resolve(remoteProfilePath);
            }
        });
    });
}

/**
 * Sets up console and file logging for the worker.
 * Overrides console methods to write to both terminal and a log file.
 * @param {string} logDirectory - The directory where the log file should be stored (e.g., .../Crawl_Timestamp/logs/).
 * @param {string} logFileName - The name of the log file (e.g., worker_puppeteer.log).
 */
function setupWorkerConsoleAndFileLogging(logDirectory, logFileName) {
    const logFilePath = path.join(logDirectory, logFileName);

    // Ensure log directory exists (it should have been created by createDir -> LOGS_SUBDIR)
    if (!fs.existsSync(logDirectory)) {
        try {
            fs.mkdirSync(logDirectory, { recursive: true });
            // console.warn('Worker log directory was not found and had to be created by logger setup:', logDirectory); // Use original console for this potential early warning
        } catch (err) {
            originalConsoleError('Failed to create worker log directory:', err, 'Logging to file will be disabled.');
            return;
        }
    }

    let logFileStream;
    try {
        logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    } catch (err) {
        originalConsoleError('Failed to create worker log file stream:', err, 'Logging to file will be disabled.');
        return;
    }

    const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug,
    };

    function formatLogMessage(level, args) {
        const timestamp = new Date().toISOString();
        const messageParts = Array.from(args).map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return util.format(arg);
                } catch (e) {
                    return '[Unserializable Object]';
                }
            }
            return String(arg);
        });
        const message = messageParts.join(' ');
        return `${timestamp} [${level.toUpperCase()}] ${message}\n`;
    }

    console.log = (...args) => {
        originalConsole.log.apply(null, args);
        if (logFileStream) logFileStream.write(formatLogMessage('log', args));
    };

    console.error = (...args) => {
        originalConsole.error.apply(null, args);
        if (logFileStream) logFileStream.write(formatLogMessage('error', args));
    };

    console.warn = (...args) => {
        originalConsole.warn.apply(null, args);
        if (logFileStream) logFileStream.write(formatLogMessage('warn', args));
    };

    console.info = (...args) => {
        originalConsole.info.apply(null, args);
        if (logFileStream) logFileStream.write(formatLogMessage('info', args));
    };

    console.debug = (...args) => {
        originalConsole.debug.apply(null, args);
        if (logFileStream) logFileStream.write(formatLogMessage('debug', args));
    };

    // Handle process exit to close the stream
    const closeStream = () => {
        if (logFileStream) {
            logFileStream.end();
            logFileStream = null; // Prevent further writes
        }
    };

    process.on('exit', closeStream);
    process.on('SIGINT', () => { closeStream(); process.exit(); });
    process.on('SIGTERM', () => { closeStream(); process.exit(); });
    process.on('uncaughtException', (err) => {
      const errorMessage = formatLogMessage('error', ['Uncaught Exception:', err]);
      if (logFileStream) {
        logFileStream.write(errorMessage, () => {
            originalConsole.error('Uncaught Exception:', err);
            process.exit(1);
        });
      } else {
        originalConsole.error('Uncaught Exception (log stream unavailable):', err);
        process.exit(1);
      }
    });
    
    originalConsoleLog('Worker console and file logging initiated. Log file:', logFilePath);
}

// Capture original console methods before they are overridden globally
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

module.exports = {
    init,
    createDir,
    createUrlDir,
    createRemoteUrlDir,
    createBrowserProfileDir,
    createRemoteProfileDir,
    checkBackslash,
    replaceDotWithUnderscore,
    formatUrlIndex,
    prettySize,
    getCrawlDir: () => crawlDir,
    getCrawlDirTimestamp: () => crawlDirTimestampExternal,
    isDirCreated: () => dirCreated,
    colorize,
    colors,
    URLS_SUBDIR,
    PROFILES_SUBDIR,
    LOGS_SUBDIR,
    OPENWPM_DATA_SUBDIR,
    setupWorkerConsoleAndFileLogging
}; 