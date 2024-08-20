const config = module.exports = {

    num_clients : 1,                  // set number of clients you want to connect
    ip : "http://192.168.178.77",     // insert master-server ip
    port : 3000,                      // set master-server port (default 3000)
    allowed_ping : 100,               // set allowed ping between clients and server
    url_list : "tranco_100.csv",       // insert name of the list containing the websites to crawl (.txt or .csv)
    calibration_runs : 2,             // set number of runs measuring the http access time between browsers (default 10)
    re_calibration : 1010,             // repeat calibration afer number of websites crawled (default 100)
    re_calibration_dc: false,           // recalibarte after reconnection of worker

    timeout_ms : 60000,               // set milliseconds after which the browser is restarted when the urldone signal is not received
                                       // adjust that to the time browsers stay on the website e.g 4x
    website_attempts : 2,              // set number of attempts to crawl a website if errors occur before URL is skipped

    test_run : false,                  // testing the synchronisation
    test_iterations : 100,           // set number of test runs

    central_datastorage : true,       // set true to store uploaded har data on the master server
    storage_path : "C:\\Users\\OLED\\Downloads\\bsyncData", // set path to store the crawl logs and uploaded har data
};
