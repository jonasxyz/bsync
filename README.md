# bsync: Synchronized Multi-Framework Browser Testing


**bsync** enables synchronized, cross-machine browser automation to test and compare how different automation frameworks interact with websites. It supports tools like Puppeteer, OpenWPM, and even **regular Firefox controlled via a custom extension**, offering a human-like baseline for bot detection.

## Why bsync?

Understanding how different automation tools are detected—or behave—requires controlled, repeatable testing. **bsync** coordinates multiple browsers to visit the same URLs **at the same time**, capturing complete HTTP/S traffic via [mitmproxy](https://github.com/mitmproxy/mitmproxy).

This allows you to:

- Benchmark automation tools against **real Firefox** behavior.
    
- Compare how websites react to different automation tools and configurations (e.g. headless).
    
- Collect HAR files for in-depth traffic analysis.
    
- Analyze detection patterns across tools and environments.
    

<!-- Placeholder for a GIF showcasing bsync in action.  -->
<p align="left"><img src="https://github.com/jonasxyz/bsync/blob/dev/Server/demo.gif" alt="bsync Demo"></p>



## Key Features

- **Native Firefox Integration**: Use a standard Firefox browser with a custom WebExtension for human-like baseline behavior.
    
- **Synchronized Testing**: All browsers access the same URL within ~1 second across machines and frameworks.
    
- **Cross-Machine and Cross-Framework Support**: Run Workers using **Puppeteer**, **OpenWPM**, or **native Firefox** on distributed systems.
    
- **Central Scheduler**: Distributes URLs and commands, synchronizes execution, and collects crawl data.
    
- **Comprehensive Logging**: Captures full HTTP/S traffic per visit as `.har` files using `mitmproxy`.
    
- **Robust & Scalable**: Built for long crawls, remote machines, and error recovery.

- **Remote Data Aggregation**: `.har` files and other relevant crawl data are stored on the Client or a NFS share.


## Architecture

`bsync` operates on a client-server model:

- **Scheduler (Server)**:
    - Manages the list of URLs to be crawled.
    - Synchronizes the start of URL visits across all Workers.
    - Receives and stores `.har` files and other data from Workers.
    - Provides a command-line interface for initiating and monitoring crawls.
- **Worker (Client)**:
    - Runs on each machine dedicated to a specific automation framework.
    - Connects to the Scheduler to receive URLs and commands.
    - Controls an automated browser (e.g., Puppeteer, OpenWPM, native Firefox) to visit the assigned URL.
    - Uses `mitmproxy` to intercept and record network traffic.
    - Saves the recorded `.har` data.

Communication between the Scheduler and Workers is handled via WebSockets (Socket.IO).

## Supported Frameworks

Currently, `bsync` has built-in support for:

- [OpenWPM](https://github.com/openwpm/OpenWPM/)
- [Puppeteer](https://github.com/puppeteer/puppeteer)
- Native Firefox Browser (controlled via a [custom WebExtension](https://github.com/jonasxyz/bsync/tree/dev/Client/firefox_extension/POC_firefox_extension))

## Native Firefox Integration

One of the key features of `bsync` is the ability to use a standard Firefox browser as a baseline for comparison with automated browser frameworks. This is accomplished through a custom WebExtension that:

- Allows a regular Firefox instance to participate in synchronized testing
- Provides a human-like browsing experience for comparison with bot-driven browsers
- Enables researchers to analyze differences between automated frameworks and genuine browser behavior
- Serves as a reliable baseline to identify potential detection techniques used by websites against bot-driven browsers

The Firefox extension integrates seamlessly with the `bsync` framework, ensuring all browsers (both automated and native) visit the same URLs at precisely coordinated times. This enables direct comparison of network traffic, rendering differences, and website behavior across different browser environments.

To use the native Firefox browser with `bsync`:

1. Install the extension from the `Client/firefox_extension/POC_firefox_extension` directory
2. Configure the Firefox profile in your worker configuration
3. Add the native Firefox as one of your worker types in the configuration

This approach is especially valuable for researchers studying bot detection mechanisms and for developers optimizing their automation frameworks to mimic genuine browser behavior.

## Getting Started

`bsync` has been primarily tested on Ubuntu 22.04 and 18.04. Although other operating systems may work, they are not officially supported.

### Prerequisites

Ensure the following are installed on all relevant machines:

**General:**
- [Node.js](https://nodejs.org/) (Version >18 recommended for both Client and Scheduler)
- [Python 3](https://www.python.org/downloads/)
- [npm (Node Package Manager)](https://www.npmjs.com/get-npm)

**Client Machines additionally require:**
- [mitmproxy](https://github.com/mitmproxy/mitmproxy) (Version >10.1.0)

### Installation

#### Automatic Installation

Run the provided installation scripts on all client machines and the scheduler machine:

- **On each Client machine:**
  Navigate to the `bsync/Client/` directory and execute:
  ```bash
  ./install.sh
  ```

- **On the Scheduler machine:**
  Navigate to the `bsync/Server/` directory and execute:
  ```bash
  ./install.sh
  ```
These scripts attempt to install all necessary dependencies and perform initial setup.

#### Manual Installation

If you prefer or need to install manually, follow these steps:

1.  **Install Core Dependencies**: Install Node.js, Python 3, and npm using your system's package manager or official installers.
2.  **Install mitmproxy (Clients only)**:
    ```bash
    pip3 install mitmproxy --user
    ```
    Ensure `mitmproxy` is in your PATH.
3.  **Install npm Packages**:
    -   **Client**:
        ```bash
        cd /path/to/your/bsync/Client/
        npm install
        ```
    -   **Scheduler**:
        ```bash
        cd /path/to/your/bsync/Server/
        npm install
        ```
4.  **Set up mitmproxy SSL Certificate (Clients only)**:
    Generate the mitmproxy CA certificate and install it in the browsers you intend to automate.
    -   Follow the [mitmproxy certificate documentation](https://docs.mitmproxy.org/stable/concepts-certificates/).
    -   **Puppeteer (Chromium)**: You may need to configure Chrome to trust the mitmproxy CA. See [this guide on SuperUser](https://superuser.com/a/1703365) for launching Chrome with custom certificates or use the `--ignore-certificate-errors` flag (not recommended for production/sensitive data).
    -   **OpenWPM (Firefox)**: Firefox profiles used by OpenWPM need to be configured to trust the mitmproxy CA. You might need to adapt general Firefox instructions, such as [this approach for certutil](https://askubuntu.com/a/1036637), adjusting paths for OpenWPM's specific Firefox profiles.

### Configuration

1.  **Configure Workers**:
    Modify Worker settings, automation framework paths, and other parameters in `bsync/Client/config.js`. Pay close attention to paths for browser executables and profiles.

2.  **Configure Scheduler**:
    Define the crawl parameters, target URL list, and server settings in `bsync/Server/config.js`. This includes specifying the list of websites to crawl (e.g., by providing a path to a CSV file like the official [Tranco Toplist](https://tranco-list.eu/)).

## Usage

1.  **Deploy `bsync`**: Ensure `bsync` is set up on all machines that will participate in the crawl (Scheduler and all Clients).
2.  **Start the Scheduler**:
    On the machine designated as the Scheduler, navigate to the `bsync/Server/` directory and run:
    ```bash
    node scheduler.js
    ```
3.  **Start the Workers**:
    On each Client machine, navigate to the `bsync/Client/` directory and run:
    ```bash
    node worker.js
    ```
4.  **Initiate the Crawl**:
    Once all Workers have successfully connected to the Scheduler, a prompt will appear in the Scheduler's terminal. Confirm this prompt to begin the synchronized crawl.
5.  **Monitor and Collect Data**:
    The Scheduler will log progress. Upon completion of the crawl (or for each site, depending on configuration), `.har` files will be saved to the designated directory.

## Dependencies

### Scheduler (`bsync/Server/`)
- [Node.js](https://nodejs.org/) (e.g., >18.x)
- [Express.js](https://www.npmjs.com/package/express) (via `package.json`)
- [Socket.IO Server](https://www.npmjs.com/package/socket.io) (via `package.json`)

### Client (`bsync/Client/`)
- [Node.js](https://nodejs.org/) (e.g., >18.x)
- [Python 3](https://www.python.org/downloads/)
- [mitmproxy](https://github.com/mitmproxy/mitmproxy) (>10.1.0)
- [Socket.IO Client](https://www.npmjs.com/package/socket.io-client) (via `package.json`)
- Framework-specific dependencies:
    - **OpenWPM**: Tested with [v0.29.0](https://github.com/openwpm/OpenWPM/releases/tag/v0.29.0). Requires its own extensive set of dependencies (Firefox, etc.).
    - **Puppeteer**: Tested with version (e.g., v22.x.x). Requires Chromium.
    - **Native Firefox**: Requires Firefox browser and the custom WebExtension from `Client/firefox_extension/POC_firefox_extension`.
