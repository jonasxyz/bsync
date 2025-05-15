// Content script that gets injected into every web page
console.log('BSYNC Firefox Extension content script loaded');

// Setup communication with background script
function sendToBackground(message) {
  browser.runtime.sendMessage(message)
    .catch(error => {
      console.error('Error sending message to background script:', error);
    });
}

// Page fully loaded
window.addEventListener('load', () => {
  console.log('Page fully loaded');
  
  // Send page fully loaded message to background script
  sendToBackground({
    type: 'pageFullyLoaded',
    url: window.location.href
  });
}); 