# BSYNC Firefox Extension

This Firefox extension integrates with the BSYNC framework to automate Firefox for web crawling tasks. It uses the same signal protocol as other automation frameworks already integrated with BSYNC.

## Requirements

- Firefox Developer Edition (or regular Firefox)
- Node.js 12+
- npm

## Installation

1. Install the necessary Node.js dependencies:

```bash
npm install
```

2. Install the Firefox extension:

```bash
npm run install-extension
```

This will create a Firefox profile named "bsync-profile" and install the extension into it.

## Usage

The extension is designed to work with the BSYNC worker.js process and communicate using the same signals as other automation frameworks like Puppeteer or OpenWPM.

### Manual Testing

For manual testing, you can run the extension directly:

```bash
npm start
```

With proxy settings:

```bash
node firefox_launcher.js --proxyhost localhost --proxyport 8080
```

This will:

1. Start a WebSocket bridge to facilitate communication
2. Launch Firefox with the installed extension
3. Wait for commands via stdin

### Integration with BSYNC

The extension is integrated with BSYNC by adding it as an automation framework option. When configured, BSYNC's worker.js will:

1. Spawn the Firefox launcher process
2. Send signals like `visit_url`, `check_browser_ready`, and `reset`
3. Receive signals like `browser_ready`, `URL_DONE`, and `ITERATION_DONE`

## Architecture

The system consists of several components:

1. **Firefox Extension**: Installed in Firefox and communicates with the WebSocket bridge
   - `manifest.json`: Extension configuration
   - `background.js`: Main extension logic that handles browser interaction
   - `content.js`: Injected into web pages to detect page load events

2. **WebSocket Bridge**: Connects the Firefox extension to the worker.js process
   - `websocket_bridge.js`: WebSocket server that forwards commands and signals

3. **Firefox Launcher**: Manages the Firefox process and bridges
   - `firefox_launcher.js`: Launches Firefox and the WebSocket bridge
   - `install_extension.js`: Helper script for installing the extension

## Signals

The extension uses the following signals to communicate with the BSYNC framework:

### From BSYNC to Firefox Extension
- `check_browser_ready`: Check if browser is ready to receive commands
- `visit_url`: Visit a URL with parameters like stay time and waiting time
- `reset`: Reset the browser state

### From Firefox Extension to BSYNC
- `browser_ready`: Indicates the browser is ready for commands
- `URL_DONE`: Indicates the URL has been loaded successfully
- `ITERATION_DONE`: Indicates the page visit iteration is complete
- `BROWSER_FINISHED`: Indicates browser operations are complete

## Proxy Support

The extension supports proxy configuration just like other automation frameworks in BSYNC. When run with worker.js, the proxy settings from the configuration will be automatically applied.

To manually specify proxy settings:

```bash
node firefox_launcher.js --proxyhost <proxy-host> --proxyport <proxy-port>
```

The proxy settings are applied by creating a `user.js` file in the Firefox profile that configures all network protocols (HTTP, HTTPS, FTP, SOCKS) to use the specified proxy server.

## Troubleshooting

- **Extension not connecting**: Ensure the WebSocket server is running and Firefox has network access to localhost
- **Firefox not launching**: Check the Firefox path in the configuration (FIREFOX_PATH in firefox_launcher.js)
- **Extensions not appearing**: Check the installation log for errors and ensure permissions are correct
- **Proxy not working**: Verify that proxy settings are correctly written to the Firefox profile's user.js file

## Customization

You can customize the extension behavior by modifying:
- The stay time on pages (default: 3 seconds)
- The Firefox profile name (default: "bsync-profile")
- The WebSocket port (default: 8765)
- Proxy settings through command-line arguments 