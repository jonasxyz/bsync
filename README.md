
# bsync

`bsync` enables synchronized testing of multiple automation frameworks deployed across different machines, allowing for an in-depth comparison of their effects on website behavior. It synchronizes multiple automated browsers to visit the same set of URLs and records their HTTP/S communication using [mitmproxy](https://github.com/mitmproxy/mitmproxy).

Currently integrated frameworks:
- [OpenWPM](https://github.com/openwpm/OpenWPM/) tested on v0.29.0
- [puppeteer](https://github.com/puppeteer/puppeteer) tested on v?

## Concept/Methodology

`bsync` allows the distribution of automation frameworks across different systems (e.g., VMs) for parallelized testing. The framework ensures that a list of URLs is synchronously assigned to workers, ensuring precise timing for visiting each site.

This approach helps in understanding how different automation frameworks and setups (e.g., headless-mode) can affect website behavior under similar conditions.

## Installation

`bsync` is tested on Ubuntu 18.04. Although other operating systems may work, they are not officially supported.

#### Automatic Installation
Run the install script on all client machines and the scheduler machine:
- On each Client machine:
`./bsync/Client/install.sh`

- On the Scheduler machine:
`./bsync/Server/install.sh`

#### Manual Installation
Alternatively if manual installation is preferred, follow these steps:
- Install [Dependencies](https://github.com/jonasxyz/bsync##Dependencies)
- Install npm packages
	-  Client: `cd /bsync/Client/ && npm install`
	- Scheduler: `cd /bsync/Server/` then `npm install`
- Create mitmproxy SSL-Certificate on each Client. Follow the [mitmproxy certificate documentation](https://docs.mitmproxy.org/stable/concepts-certificates/).
- Configure Automated Browsers to use custom certificate. Both browser currently don't use the system wide certificate store and need further setup:
	- Puppeteer: See [this setup](https://superuser.com/a/1703365).
	- OpenWPM: Follow [this approach](https://askubuntu.com/a/1036637) but adjust paths for OpenWPM's Firefox instance.


## Usage

1. Setup `bsync` on all machines that will run the automation frameworks
2. Configure Workers
Modify the Worker and Automation Framework settings in the [config.js](https://github.com/jonasxyz/bsync/Client/config.js) file
3. Choose a machine to run the Scheduler on
The Scheduler manages synchronization and central control. Can be any machine.
4. Configure Scheduler:
Update the Scheduler configuration in `bsync/Server/config.py` to define the crawl
5. Run `bsync` instances  
Start both the Scheduler and Worker instances in the terminal:
	- On the Scheduler:
`node bsync/Server/scheduler.js`
	- On the Clients:
`node bsync/Client/worker.js`
7. **Start the Crawl**:  
After the connection is established between the Scheduler and Workers, accept the prompt on the Scheduler to begin the crawl.

  

## Features

- **Synchronized Access**: Ensure all browsers access webpages within a 1-second margin of error across different frameworks and machines.
- **Test Runs**: Perform test runs to check synchronization, allowing further calibration of browser settings.

-   **Centralized Control**: The Scheduler provides a centralized control point for all Worker instances.

- **Automatic HTTP/S Recording**: Record and save HTTP/S communication in `.har`format  for each website using `mitmproxy`.

- **Error Handling and Recovery**: Robust error handling and automatic recovery mechanisms ensure long-term stability of crawlers.
- **Remote Data Storage**: Store `.har` files and other data on the Scheduler machine for easy access and analysis.


## Dependencies

### Client
[Node.js](https://github.com/nodejs) > 18
python3 
[mitmproxy](https://github.com/mitmproxy/mitmproxy) > 10.1.0
[socket.io-client](https://www.npmjs.com/package/socket.io-client)

[OpenWPM](https://github.com/openwpm/OpenWPM/releases/tag/v0.29.0) tested on v0.29.0
[puppeteer](https://github.com/puppeteer/puppeteer) tested on v?

### Scheduler
[Node.js](https://github.com/nodejs) 
[socket.io-server]
express
