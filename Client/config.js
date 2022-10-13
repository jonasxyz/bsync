const configuration = {

	base: {
		master_addr: "http://192.168.178.37:3000", // e.g. "http://localhost:3000"
	},
	puppeteer: {
		client_name: "puppeteer", 						// must be unique
		headless: false,

		crawl_script: "puppeteer_synced.js", 
		script_path: "/home/user/Schreibtisch/bsync/Client/puppeteer",

		enable_proxy : true, 							// set true to disable mitmproxy
		har_destination : "/home/user/Schreibtisch/HTTP/puppeteer/",		// e.g. "/home/user/http/"
		proxy_host : "127.0.0.1",
		proxy_port : "3031",
	},
	StealthyWPM: {
		client_name : "OpenWPM", 
		headless : false,

		crawl_script : "openwpm_synced.py", 
		script_path : "/home/user/Schreibtisch/StealthyWPM",

		enable_proxy : true,
		har_destination : "/home/user/Schreibtisch/HTTP/StealthyWPM/",
		proxy_host : "127.0.0.1",
		proxy_port : "3031",
	}
}

// would be possible to switch between frameworks with settings different node environments
module.exports = {
	base : configuration.base,
	// set worker
	// worker : configuration.puppeteer,
	worker : configuration.StealthyWPM,
}