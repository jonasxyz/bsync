const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const os = require('os');

// Import Firefox profile manager
const profileManager = require('./firefox_profile_manager');

// Import BSYNC configuration
try {
  const configPath = path.resolve(__dirname, '../..', 'config.js');
  console.log(`Loading configuration from: ${configPath}`);
  const config = require(configPath);
  var worker = config.activeConfig.worker;
} catch (error) {
  console.error(`Error loading configuration: ${error.message}`);
  console.log('Using default configuration');
  var worker = { 
    //browser_path: "/usr/bin/firefox", 
    browser_path: "/opt/firefox-138.0.1/firefox", 
    enable_proxy: false,
    proxy_host: "localhost", 
    proxy_port: 8080
  };
}

// Configuration
const WS_PORT = 8765;
const DEBUG = false;
const isWindows = process.platform === 'win32';

// Find zombie process
// sudo lsof -i :8765

// Firefox configuration - dynamically from config or fallback
const FIREFOX_PATH = worker.browser_path || (isWindows 
  ? "C:\\Program Files\\Firefox Developer Edition\\firefox.exe" 
  : "/usr/bin/firefox"); // Default path for Firefox on Linux

// Firefox extension configuration
const EXTENSION_PATH = path.join(__dirname, 'extension');

// State variables
let extensionConnection = null;
let browserIsReady = false;
let firefoxProcess = null;
let readySignalSent = false;
let tempProfileDir = null;
let profileCreated = false;

// Proxy configuration - initialize with values from config if possible
let proxyHost = worker.proxy_host || null;
let proxyPort = worker.proxy_port || null;

// AutoLoad configuration
let firefoxInstallPath = null;

// Parse command line arguments for proxy settings and browser profile path
let customProfilePath = null;
function parseArguments() {
  process.argv.forEach((arg, index) => {
    if (arg === '--proxyhost' && process.argv[index + 1]) {
      proxyHost = process.argv[index + 1];
    }
    if (arg === '--proxyport' && process.argv[index + 1]) {
      proxyPort = process.argv[index + 1];
    }
    if (arg === '--browserprofilepath' && process.argv[index + 1]) {
      customProfilePath = process.argv[index + 1];
      console.log('Custom profile path set:', customProfilePath);
    }
    if (arg === '--firefox-path' && process.argv[index + 1]) {
      firefoxInstallPath = process.argv[index + 1];
      console.log('Firefox installation path set:', firefoxInstallPath);
    }
  });
  
  if (proxyHost || proxyPort) {
    console.log(`Proxy settings detected: ${proxyHost}:${proxyPort}`);
  }
}

// WebSocket server for communication with Firefox extension
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket server started on port ${WS_PORT}`);

// Handle connection from Firefox extension
wss.on('connection', (ws) => {
  console.log('New WebSocket connection from Firefox extension');
  extensionConnection = ws;
  
  // Receive messages from extension
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (DEBUG) console.log(`Message from Firefox: ${JSON.stringify(data)}`);
      
      // Process message based on type
      switch (data.type) {
        case 'browser_ready':
          browserIsReady = true;
          //console.log('Browser is ready for commands!');
          process.stdout.write("browser_ready\n");
          break;
        case 'URL_DONE':
          if (data.error) {
            console.error(`Page ${data.url} failed to load: ${data.errorMessage}`);
            process.stdout.write("URL_ERROR\n");
          } else {
            console.log(`Page ${data.url} loaded successfully!`);
            process.stdout.write("URL_DONE\n");
          }
          break;
        case 'navigation_error':
          console.error(`Navigation error for ${data.url}: ${data.error}`);
          // Continue processing, don't break the flow
          break;
        case 'BROWSER_FINISHED':
          //console.log('Iteration completed');
          process.stdout.write("BROWSER_FINISHED\n");
          break;
        case 'reset_complete':
          //console.log('Browser-Reset completed');
          process.stdout.write("BROWSER_FINISHED\n");
          break;
        default:
          if (DEBUG) console.log(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
  
  // Handle connection loss
  ws.on('close', () => {
    console.log('WebSocket connection to extension closed');
    extensionConnection = null;
    browserIsReady = false;
  });
});

/**
 * Send commands to Firefox extension
 */
function sendCommandToExtension(command) {
  if (extensionConnection) {
    // console.log(`Sending command to Firefox: ${JSON.stringify(command)}`); // Debug
    extensionConnection.send(JSON.stringify(command));
    return true;
  } else {
    console.error('No connection to Firefox extension');
    return false;
  }
}

/**
 * Launch Firefox with BSYNC extension
 */
async function launchBrowser() {
  try {
    console.log('Starting Firefox...');
    
    // Create Firefox profile using profile manager
    const profileOptions = {
      extensionPath: EXTENSION_PATH,
      enableProxy: worker.enable_proxy,
      proxyHost: proxyHost,
      proxyPort: proxyPort,
      firefoxPath: firefoxInstallPath,
    };

    // If custom profile path is provided, use it as base directory
    if (customProfilePath) {
      profileOptions.customProfilePath = customProfilePath;
      console.log(`Using custom profile base path: ${customProfilePath}`);
    }

    const profileInfo = profileManager.createFirefoxProfile(profileOptions);
    
    if (!profileInfo) {
      throw new Error('Error creating Firefox profile');
    }
    
    // Start Firefox
    console.log(`Starting Firefox with custom profile at: ${profileInfo.profilePath}`);
    
    // Firefox arguments - directly with -profile and absolute path
    const firefoxArgs = ['-profile', profileInfo.profilePath, '-no-remote', 'about:blank'];
    
    console.log(`Firefox command: ${FIREFOX_PATH} ${firefoxArgs.join(' ')}`);
    
    // Start Firefox process
    firefoxProcess = spawn(FIREFOX_PATH, firefoxArgs, {
      stdio: 'pipe',
      detached: false
      // stdio: 'ignore',
      // detached: true
    });
    
    firefoxProcess.on('error', (error) => {
      console.error(`Error starting Firefox: ${error.message}`);
      process.exit(1);
    });
    
    // Don't wait for Firefox process
    //firefoxProcess.unref(); // Todo check if this is needed
    
    console.log('Firefox started successfully');
    
  } catch (error) {
    console.error("Critical error:", error);
    process.exit(1);
  }
}

/**
 * Reset browser by restarting Firefox
 */
async function shutdownBrowser( restart = false) {
  console.log("Resetting browser...");
  
  // Terminate current Firefox process
  if (firefoxProcess) {
    try {
      if (isWindows) {
        spawn('taskkill', ['/F', '/PID', firefoxProcess.pid], { 
          shell: true, 
          stdio: 'ignore' 
        });
      } else {
        try {
          process.kill(-firefoxProcess.pid, 'SIGKILL');
        } catch (e) {
          console.log(`Error terminating Firefox process directly, trying with kill command: ${e.message}`);
          // Alternative kill method
          require('child_process').execSync(`kill -9 ${firefoxProcess.pid}`, {
            stdio: 'ignore'
          });
        }
      }
    } catch (error) {
      console.error(`Error terminating Firefox process: ${error.message}`);
    }
  }
  
  // Clean up old profile
  //profileManager.cleanupTempProfile();
  
  // Restart Firefox with new profile
  if (restart) {
    await launchBrowser();
  }
  return true;
}

// Clean up on exit
process.on('exit', () => {
  //profileManager.cleanupTempProfile();
});

process.on('SIGINT', () => {
  console.log('SIGINT received, cleaning up...');
  
  if (firefoxProcess) {
    if (isWindows) {
      spawn('taskkill', ['/F', '/PID', firefoxProcess.pid], { shell: true });
    } else {
      try {
        process.kill(-firefoxProcess.pid);
      } catch (error) {
        console.error('Error terminating Firefox process:', error);
      }
    }
  }
  
  //profileManager.cleanupTempProfile();
  
  // Close WebSocket server
  if (wss) {
    wss.close();
  }
  
  process.exit(0);
});

// Read commands from worker.js via stdin
process.stdin.on('readable', () => {
  try {
    const input = process.stdin.read();
    
    if (input !== null) {
      const command = input.toString().trim();
      
      if (command === 'check_readiness') {
        if (browserIsReady) {
          // If we already know the browser is ready
          process.stdout.write("browser_ready\n");
        } else {
          // Ask the browser again
          sendCommandToExtension({ type: 'checkReady' });
        }
      } else if (command.startsWith('visit_url')) {
        try {

          // Extract URL parameters from the command
          const jsonStr = command.substring('visit_url'.length).trim();
          const data = JSON.parse(jsonStr);
          
          if (!data.url) {
            console.error("Error: URL missing in visit_url command");
            return;
          }

          console.log(`visit_url received from worker.js: url: "${data.url}" visitDuration: ${data.visitDuration} waitingTime: ${data.waitingTime}`);

          // Forward URL command to the extension
          sendCommandToExtension({
            type: 'VISIT_URL',
            url: data.url,
            stayTime: parseInt(data.visitDuration) || 3,
            waitingTime: data.waitingTime || 0
          });
        } catch (error) {
          console.error(`Error parsing visit_url command: ${error.message}`);
        }
      } else if (command === 'reset') {
        sendCommandToExtension({ type: 'reset' });
      } else if (command === 'shutdown') {
        shutdownBrowser(false);
      } else  {
        console.log(`Unknown command from worker.js: ${command}`);
      }
    }
  } catch (error) {
    console.error(`Error reading stdin: ${error.message}`);
  }
});

// Main execution
(async () => {
  // Parse command line arguments
  parseArguments();
  
  // Start browser
  await launchBrowser();
  
  // Create interface for commands from command line
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  
  console.log('Integrated Firefox controller ready for commands from worker.js and connections from Firefox');
})(); 