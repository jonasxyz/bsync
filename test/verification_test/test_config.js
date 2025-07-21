const os = require('os');

const testConfig = {
    // Server-Konfiguration
    server: {
        num_clients: 1,
        ip: "http://127.0.0.1",
        port: 3000,
        allowed_ping: 100,
        url_list: "test/verification_test/test_url.txt", // Eine einzelne URL für den Test
        calibration_runs: 1,
        re_calibration: 0,
        re_calibration_dc: false,
        timeout_ms: 60000,
        website_attempts: 1,
        test_run: false, // Wir führen einen normalen Crawl durch, keinen Test-Run
        storage_path: "/home/" + os.userInfo().username + "/Downloads/bsync-test-data",
        remote_storage_nfs: false,
    },
    // Client-Konfiguration
    client: {
        activeWorker: "OpenWPM", // Wichtig: Wir testen OpenWPM

        base: {
            master_addr: "http://127.0.0.1:3000",
            pagevisit_duration: 5,
            nfs_remote_filestorage: false,
            persistent_proxy: true,
            proxy_debug_output: true,
        },
        OpenWPM: {
            client_name: "OpenWPM_Test_Worker",
            headless: false,
            crawl_script: "openwpm_synced.py",
            //script_path: __dirname + "/../../Client/OpenWPM", // Pfad anpassen
            script_path:"/home/" + os.userInfo().username + "/Desktop/OpenWPM",
            crawl_data_path: "/home/" + os.userInfo().username + "/Downloads/bsync-test-data",
            har_destination: "/home/" + os.userInfo().username + "/Downloads/bsync-test-data",
            enable_proxy: true,
            proxy_host: "127.0.0.1",
            proxy_port: "3031",
        },
        // Die anderen Worker-Konfigurationen sind für diesen Test nicht relevant
        puppeteer: {},
        native_firefox: {}
    }
};

// Kombinieren der Client-Konfiguration für den Worker
const activeClientConfig = {
    base: testConfig.client.base,
    worker: testConfig.client[testConfig.client.activeWorker],
};


module.exports = {
    serverConfig: testConfig.server,
    clientConfig: {
        activeConfig: activeClientConfig,
	    activeWorker: testConfig.client.activeWorker
    }
}; 