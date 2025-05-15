const configuration = {
	activeWorker: "puppeteer", 							// Set this to "puppeteer" or "OpenWPM" or "native_firefox"

	base: {
		master_addr: "http://192.168.178.90:3000", 		// e.g. "http://localhost:3000"
		pagevisit_duration: 6,							// Specify time in seconds the browser stays on websites

		nfs_remote_filestorage: true,					// Set true to store har files on nfs server
		delete_after_upload: true,						// Set true to delete the local har files after upload
		nfs_server_address: "10.10.10.1",				// Address of the nfs server
		nfs_server_path: "/nfs/bsync-Data/",			// Path to the nfs shared folder on the server


		persistent_proxy: true,							// set true to keep the proxy running after the browser is closed
	},
	puppeteer: {
		client_name: "puppeteer_HL", 					// must be unique
		headless: true,

		crawl_script: "puppeteer_synced.js", 
		script_path: __dirname + "/puppeteer",
		crawl_data_path: "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/",

		enable_proxy : false, 							// Set false to disable mitmproxy
		har_destination : "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/", // e.g. "/home/user/http/" //todo auf ubuntu18 funktioniet nur noch USER anstatt USERNAME
		proxy_host : "127.0.0.1",
		proxy_port : "3031",
	},
	OpenWPM: {
		client_name : "OpenWPM", 
		headless : true,

		crawl_script : "openwpm_synced.py", 
		// script_path : "/home/user/Schreibtisch/StealthyWPM",
		script_path : "/home/" + process.env.USERNAME +"/Desktop/OpenWPM", 
		crawl_data_path: "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/",

		enable_proxy : false,
		har_destination : "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/",
		proxy_host : "127.0.0.1",
		proxy_port : "3031",
	},
	native_firefox: {
		client_name : "native_firefox", 
		headless : false,

		crawl_script : "firefox_launcher.js", 
		script_path : __dirname + "/firefox_extension/POC_firefox_extension",

		browser_path : "/opt/firefox-dev/firefox",		// Set path to firefox executable e.g. "/opt/firefox-dev/firefox"
		browser_profile_path : "",
		crawl_data_path: "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/",

		enable_proxy : true,
		har_destination : "/home/" + process.env.USERNAME +"/Downloads/Crawl-Data/",
		proxy_host : "127.0.0.1",
		proxy_port : "3031",
	}
}

const activeConfig = {
	base : configuration.base,
    worker: configuration[configuration.activeWorker],
}

module.exports = {
	activeConfig,
	activeWorker: configuration.activeWorker
}
