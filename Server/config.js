const config = module.exports = {

    num_clients : 4,                  // set number of clients you want to connect
    ip : "http://10.10.10.11",        // insert master-server ip
    port : 3000,                      // set master-server port (default 3000)
    allowed_ping : 100,               // set allowed ping between clients and server
    url_list : "tranco_5X8WN-100.csv",      // insert name of the list containing the websites to crawl (.txt or .csv)
    calibration_runs : 5,             // set number of runs measuring the http access time between browsers (default 10)
    re_calibration : 1010,            // repeat calibration afer number of websites crawled (default 100)
    re_calibration_dc: false,         // recalibarte after reconnection of worker

    timeout_ms : 60000,               // set milliseconds after which the browser is restarted when the urldone signal is not received
                                       // adjust that to the time browsers stay on the website e.g 4x
    website_attempts : 2,              // set number of attempts to crawl a website if errors occur before URL is skipped

    test_run : false,                  // testing the synchronisation
    test_iterations : 100,           // set number of test runs

    storage_path : "/home/user/Downloads/Crawl-Data", // set path to store the crawl logs and uploaded har data
    analyze_hars_after_crawl: false,   // set to true to automatically analyze HAR files after crawl finishes

    remote_storage_nfs : true,        // set true to store crawl logging on the NFS server
    nfs_server_path : "/nfs/bsync-Data/", // set path to store the crawl logs and uploaded har data
};
