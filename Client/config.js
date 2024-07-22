const fs = require('fs');
const path = require('path');

const configuration = {

	base: {
		master_addr: "http://192.168.178.83:3000", 		// e.g. "http://localhost:3000"
		pagevisit_duration: 3							// specify time in seconds the browser stays on websites

	},
	puppeteer: {
		client_name: "puppeteer", 						// must be unique
		headless: false,

		crawl_script: "puppeteer_synced.js", 
		// script_path: "/home/user/Schreibtisch/bsync/Client/puppeteer", old 13:06 12-07-24
		script_path: __dirname + "/puppeteer",

		enable_proxy : true, 							// set false to disable mitmproxy
		//har_destination : "/home/user/Schreibtisch/HTTP/puppeteer/",		// old
		har_destination : "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/", // e.g. "/home/user/http/"
		proxy_host : "127.0.0.1",
		proxy_port : "3031",
	},
	OpenWPM: {
		client_name : "OpenWPM", 
		headless : false,

		crawl_script : "openwpm_synced.py", 
		// script_path : "/home/user/Schreibtisch/StealthyWPM",
		script_path : "/home/" + process.env.USERNAME +"/Downloads/OpenWPM", 
		crawl_data_path: "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/",

		enable_proxy : true,
		har_destination : "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/",
		proxy_host : "127.0.0.1",
		proxy_port : "3031",
	}
}

const activeConfig = {
	base : configuration.base,
	worker : configuration.OpenWPM // set worker
	//worker : configuration.puppeteer 
}


const outputPath = path.join(__dirname, 'config.json'); // JSON output for OpenWPM settings
fs.writeFileSync(outputPath, JSON.stringify(activeConfig, null, 2));


// would be possible to switch between frameworks with settings different node environments
module.exports = {
	activeConfig
}
