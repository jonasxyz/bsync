const config = module.exports = {

    num_clients : 4,                  // set number of clients you want to connect
    ip : "http://192.168.178.73",    // insert master-server ip
    port : 3000,                      // set master-server port (default 3000)
    allowed_ping : 100,               // set allowed ping between clients and server
    url_list : "tranco100.csv",       // insert name of the list containing the websites to crawl (.txt or .csv)
    calibration_runs : 0,             // set number of runs measuring the http access time between browsers (default 10)
    re_calibration : 100,             // repeat calibration afer number of websites crawled (default 100)
    
    timeout_ms : 120000,              // set milliseconds after which the browser is restarted when the urldone signal is not received
                                      // adjust that to the time browsers stay on the website e.g 4x
    
    test_run : false,                 // testing the synchronisation
    test_iterations : 1000,           // set number of test runs

    
};