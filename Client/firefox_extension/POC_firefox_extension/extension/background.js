// WebSocket connection to Node.js server
let socket = null;
const WS_SERVER = 'ws://localhost:3001';

// Current state
let currentUrl = null;
let tabId = null;
let stayTimeMs = 3000; // Default stay time in milliseconds
let waitingTime = 0; // Default waiting time before loading URL

// Eine Variable zur Verfolgung, ob bereits ein Timer für die aktuelle Seite gesetzt wurde
let timerActive = false;

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
            visitUrl(message.url, message.stayTime || 3);
          }, waitingTime);
        } else {
          visitUrl(message.url, message.stayTime || 3);
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

// Load URL in a tab
function visitUrl(url, stayTime = 3) {
  console.log(`Loading URL: ${url} with stay time: ${stayTime}s`);
  currentUrl = url;
  stayTimeMs = stayTime * 1000;
  
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
      // Report error back to server
      sendToServer({
        type: 'error',
        message: `Failed to load URL: ${error.message}`
      });
    });
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
  // Only consider main frame events for the correct tab and only if no timer is active
  // Exclude about:blank URLs from triggering the main handler
  if (details.frameId === 0 && details.tabId === tabId && !timerActive && details.url !== 'about:blank') {
    console.log(`Page loaded: ${details.url}`);
    
    // Markiere, dass ein Timer aktiv ist
    timerActive = true;
    
    // After stayTime, navigate to about:blank and send BROWSER_FINISHED
    setTimeout(() => {
      console.log(`Stay time completed (${stayTimeMs}ms), navigating to about:blank`);
      timerActive = false;
      
      // Send URL_DONE signal first
      sendToServer({
        type: 'URL_DONE',
        url: details.url
      });

      // Then navigate to about:blank
      browser.tabs.update(tabId, { url: 'about:blank' })
        .then(() => {
          // Monitor for about:blank completion and send BROWSER_FINISHED only when it's loaded
          const aboutBlankHandler = (navDetails) => {
            if (navDetails.frameId === 0 && 
                navDetails.tabId === tabId && 
                navDetails.url === 'about:blank') {
              // Remove this event listener
              browser.webNavigation.onCompleted.removeListener(aboutBlankHandler);
              
              // Send BROWSER_FINISHED after about:blank has loaded
              sendToServer({
                type: 'BROWSER_FINISHED'
              });
            }
          };
          
          // Add special event listener for about:blank loading
          browser.webNavigation.onCompleted.addListener(aboutBlankHandler);
        })
        .catch(error => {
          console.error('Error navigating to about:blank:', error);
          // Send BROWSER_FINISHED even if there was an error
          sendToServer({
            type: 'BROWSER_FINISHED'
          });
        });
    }, stayTimeMs);
  }
});

// Start connection when the extension loads
connectToServer(); 