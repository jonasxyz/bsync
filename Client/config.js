const config = module.exports = {

	client_name : "puppeteer", 						// must be unique
	headless : false,

	crawl_script : "puppeteer_synced.py", 
	script_path : "/home/user/Schreibtisch/bsync/Client/puppeteer",

	master_addr : "http://192.168.178.73:3000", 				// e.g. "http://localhost:3000"

	disable_proxy : true, 							// set true to disable mitmproxy
	har_destination : "/home/user/Schreibtisch/client/http_v2/",      	// e.g. "/home/user/http/"
	proxy_host : "127.0.0.1",
	proxy_port : "3031",
	proxy_script_location : "/home/user/Schreibtisch/http/",

};
