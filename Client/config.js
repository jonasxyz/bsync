const config = module.exports = {

	//client_name : "puppeteer", 						// must be unique
	client_name : "StealthyWPM", 
	headless : false,

	//crawl_script : "puppeteer_synced.js", 
	//script_path : "/home/user/Schreibtisch/bsync/Client/puppeteer",

	crawl_script : "openwpm_synced.py", 
	//script_path : "/home/user/Schreibtisch/StealthyWPM",

	script_path : "/home/user/Schreibtisch/OpenWPM",


	master_addr : "http://192.168.178.73:3000", 				// e.g. "http://localhost:3000"

	disable_proxy : false, 							// set true to disable mitmproxy
	har_destination : "/home/user/Schreibtisch/HTTP/c/",      	// e.g. "/home/user/http/"
	proxy_host : "127.0.0.1",
	proxy_port : "3031",

	// run in shell with node worker.js
};
