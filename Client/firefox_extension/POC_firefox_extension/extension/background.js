// WebSocket connection to Node.js server
let socket = null;
const WS_SERVER = 'ws://localhost:8765';

// Current state
let currentUrl = null;
let tabId = null;
let stayTimeMs = 3000; // Default stay time in milliseconds
let waitingTime = 0; // Default waiting time before loading URL
let takeScreenshot = false; // Whether to take a screenshot

let timerActive = false; // True if a stay period (after success or error) or navigation timeout handling is active

// Timeout for visiting a URL (20 seconds)
const NAVIGATION_TIMEOUT = 20000; // ms
let navigationTimeoutId = null;

// ID for the timeout that runs after a page successfully loads or an error occurs, before navigating to about:blank
let currentNavigationStayTimeoutId = null;
// Holder for the specific about:blank onCompleted listener
let aboutBlankLoadListener = null;

// Connect to the websocket server
function connectToServer() {
  console.log('Connecting to WebSocket server...');
  
  socket = new WebSocket(WS_SERVER);
  
  socket.onopen = function() {
    console.log('WebSocket connection established');
    
    // Send message that the browser is ready
    sendToServer({
      type: 'browser_ready'
    });
  };
  
  socket.onmessage = function(event) {
    try {
      const message = JSON.parse(event.data);
      console.log('Message received from server:', message);
      
      // Process commands from server
      if (message.type === 'VISIT_URL') {
        // If waitingTime is specified, wait before loading the URL
        if (message.waitingTime && message.waitingTime > 0) {
          waitingTime = message.waitingTime;
          console.log(`Waiting ${waitingTime}ms before loading URL`);
          setTimeout(() => {
            visitUrl(message.url, message.stayTime || 3, message.takeScreenshot || false);
          }, waitingTime);
        } else {
          visitUrl(message.url, message.stayTime || 3, message.takeScreenshot || false);
        }
      } else if (message.type === 'reset') {
        resetBrowser();
      } else if (message.type === 'checkReady') {
        // Respond with browser_ready status
        sendToServer({
          type: 'browser_ready'
        });
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  };
  
  socket.onclose = function() {
    console.log('WebSocket connection closed');
    // Try to reconnect after a delay
    setTimeout(connectToServer, 5000);
  };
  
  socket.onerror = function(error) {
    console.error('WebSocket error:', error);
  };
}

// Send message to the server
function sendToServer(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    console.error('No connection to server');
  }
}

// Helper to cleanup the about:blank listener
function cleanupAboutBlankListener() {
    if (aboutBlankLoadListener && browser.webNavigation.onCompleted.hasListener(aboutBlankLoadListener)) {
        browser.webNavigation.onCompleted.removeListener(aboutBlankLoadListener);
    }
    aboutBlankLoadListener = null;
}

// Function to safely add and manage the about:blank listener
function listenForAboutBlankAndFinalize(expectedTabId, originContext) {
    cleanupAboutBlankListener(); // Remove any existing listener first

    aboutBlankLoadListener = (navDetails) => {
        if (navDetails.frameId === 0 &&
            navDetails.tabId === expectedTabId &&
            navDetails.url === 'about:blank') {
            
            cleanupAboutBlankListener(); // Remove self

            console.log(`about:blank loaded for tab ${expectedTabId} (context: ${originContext}), sending BROWSER_FINISHED.`);
            sendToServer({ type: 'BROWSER_FINISHED' });
        }
    };
    browser.webNavigation.onCompleted.addListener(aboutBlankLoadListener);
}

// Central function to finalize a navigation cycle (success or error)
async function finalizeCycle(urlForDone, errorInfo) {
    console.log(`Finalizing cycle for ${urlForDone}. Error: ${errorInfo ? errorInfo.message : 'No'}`);
    timerActive = false;

    try {
        // Take screenshot if requested
        if (takeScreenshot) {
            try {
                const dataUrl = await browser.tabs.captureVisibleTab();
                sendToServer({ type: 'SCREENSHOT_DATA', data: dataUrl });
            } catch (err) {
                console.error("Error taking screenshot:", err);
            }
        }

        // Send URL_DONE signal
        const urlDoneMessage = { type: 'URL_DONE', url: urlForDone };
        if (errorInfo && errorInfo.isError) {
            urlDoneMessage.error = true;
            urlDoneMessage.errorMessage = errorInfo.message;
        }
        sendToServer(urlDoneMessage);

        // Then navigate to about:blank
        await browser.tabs.update(tabId, { url: 'about:blank' });
        const context = errorInfo && errorInfo.isError ? `${urlForDone} (after error: ${errorInfo.message})` : urlForDone;
        listenForAboutBlankAndFinalize(tabId, context);

    } catch (error) {
        console.error(`Error during finalizeCycle for ${urlForDone}:`, error);
        cleanupAboutBlankListener(); // Ensure listener is cleaned up
        sendToServer({ type: 'BROWSER_FINISHED' }); // Still send BROWSER_FINISHED to unblock the system
    }
}

// Load URL in a tab
function visitUrl(url, stayTime = 3, screenshot = false) {
  console.log(`Loading URL: ${url} with stay time: ${stayTime}s`);
  currentUrl = url;
  stayTimeMs = stayTime * 1000;
  takeScreenshot = screenshot;
  
  // Clear any pending stay timeout from a previous navigation cycle
  if (currentNavigationStayTimeoutId) {
    clearTimeout(currentNavigationStayTimeoutId);
    currentNavigationStayTimeoutId = null;
  }
  
  // Remove any lingering about:blank listener from a previous cycle
  cleanupAboutBlankListener();

  timerActive = false; // Reset timer state for the new navigation attempt. Crucial.
  
  // Clear any existing navigation timeout for the overall page load
  if (navigationTimeoutId) {
    clearTimeout(navigationTimeoutId);
    navigationTimeoutId = null;
  }
  
  // Set navigation timeout - if page doesn't load or error out within timeout, treat as error
  navigationTimeoutId = setTimeout(() => {
    if (timerActive) { 
      return;
    }
    console.error(`Navigation timeout for URL: ${currentUrl} (timerActive was false at timeout)`);
    handleNavigationError(currentUrl, 'Navigation timeout');
  }, NAVIGATION_TIMEOUT);
  
  // Find existing tabs
  browser.tabs.query({})
    .then(tabs => {
      if (tabs.length > 0) {
        // Use the first tab
        tabId = tabs[0].id;
        return browser.tabs.update(tabId, { url: url });
      } else {
        // Create a new tab if none exists
        return browser.tabs.create({ url: url }).then(tab => {
          tabId = tab.id;
          return tab;
        });
      }
    })
    .catch(error => {
      console.error('Error loading URL:', error);
      handleNavigationError(url, error.message);
    });
}

// Handle navigation errors (timeout, network errors, etc.)
function handleNavigationError(url, errorMessage) {
  console.error(`Navigation error for ${url}: ${errorMessage}`);
  
  if (navigationTimeoutId) {
    clearTimeout(navigationTimeoutId);
    navigationTimeoutId = null;
  }
  
  if (currentNavigationStayTimeoutId) {
    clearTimeout(currentNavigationStayTimeoutId);
    currentNavigationStayTimeoutId = null;
  }
  
  timerActive = true; 
  
  sendToServer({
    type: 'navigation_error',
    url: url, 
    error: errorMessage
  });
  
  console.log(`Navigation error occurred for ${url}, but waiting ${stayTimeMs}ms (stayTime) before proceeding`);
  
  currentNavigationStayTimeoutId = setTimeout(() => {
    timerActive = false; // Explicitly reset before finalizeCycle
    currentNavigationStayTimeoutId = null;
    finalizeCycle(url, { isError: true, message: errorMessage });
  }, stayTimeMs);
}

// Reset browser state
function resetBrowser() {
  console.log('Resetting browser state');
  
  // Clear all tabs except one
  browser.tabs.query({})
    .then(tabs => {
      if (tabs.length > 0) {
        // Keep the first tab, close others
        tabId = tabs[0].id;
        
        // Navigate first tab to about:blank
        browser.tabs.update(tabId, { url: 'about:blank' });
        
        // Close other tabs
        for (let i = 1; i < tabs.length; i++) {
          browser.tabs.remove(tabs[i].id);
        }
      }
    })
    .then(() => {
      // Report reset completed
      sendToServer({
        type: 'reset_complete'
      });
    })
    .catch(error => {
      console.error('Error resetting browser:', error);
    });
}

// Monitor tab navigation to notify server when a page has loaded
browser.webNavigation.onCompleted.addListener(details => {
  if (details.frameId === 0 && details.tabId === tabId) {

    if (timerActive) {
      return;
    }

    if (details.url === 'about:blank') {
      // This is handled by listenForAboutBlankAndFinalize, called from finalizeCycle
      return;
    }
    
    console.log(`Page loaded: ${details.url} (current target was: ${currentUrl})`);
    
    if (navigationTimeoutId) {
      clearTimeout(navigationTimeoutId);
      navigationTimeoutId = null;
    }
    
    timerActive = true;
    
    if (currentNavigationStayTimeoutId) clearTimeout(currentNavigationStayTimeoutId);

    currentNavigationStayTimeoutId = setTimeout(() => {
      timerActive = false; // Explicitly reset before finalizeCycle
      currentNavigationStayTimeoutId = null;
      finalizeCycle(details.url, null); // null for errorInfo means success
    }, stayTimeMs);
  }
});

// Handle navigation errors (DNS errors, connection refused, etc.)
browser.webNavigation.onErrorOccurred.addListener(details => {
  // Only consider main frame events for the correct tab.
  if (details.frameId === 0 && details.tabId === tabId) {
    
    // If timerActive is true, it means another handler (success or error stay period)
    // for this navigation attempt is already active. Ignore this subsequent error.
    if (timerActive) {
      // console.log(`onErrorOccurred for ${details.url} on tab ${details.tabId} ignored as timerActive is true.`);
      return;
    }
    
    // details.url is the URL that encountered the error.
    // currentUrl is the URL we initially tried to navigate to.
    console.error(`Navigation error occurred: ${details.error} for URL: ${details.url} (current target was: ${currentUrl})`);
    
    // Call handleNavigationError with currentUrl, as that's the primary URL of this attempt.
    // The specific erroring URL (details.url) is included in the message.
    handleNavigationError(currentUrl, details.error + ` (occurred at ${details.url})`);
  }
});

// Handle tab crashes or other critical errors
browser.tabs.onUpdated.addListener((updateTabId, changeInfo, tab) => {
  if (updateTabId === tabId && changeInfo.status === 'complete' && tab.url && tab.url.startsWith('about:neterror')) {
    console.error(`Network error page detected for tab ${updateTabId}`);
    handleNavigationError(currentUrl, 'Network error page detected');
  }
});

// Start connection when the extension loads
connectToServer(); 