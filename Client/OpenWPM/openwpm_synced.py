from pathlib import Path

from openwpm.command_sequence import CommandSequence
from openwpm.commands.browser_commands import GetCommand
from openwpm.config import BrowserParams, ManagerParams
from openwpm.storage.sql_provider import SQLiteStorageProvider
from openwpm.task_manager import TaskManager


from write_done import writeDoneCommand #new

import sys
import fileinput
from time import sleep 

# get time to wait before visiting website from arguments and convert to seconds
waitingTime = (int(sys.argv[6])) / 1000
userAgent = sys.argv[5]
proxy = sys.argv[3]
proxyPort = sys.argv[4]

# The list of sites that we wish to crawl
NUM_BROWSERS = 1
sites = [
    sys.argv[1]
]

# Loads the default ManagerParams
# and NUM_BROWSERS copies of the default BrowserParams

manager_params = ManagerParams(num_browsers=NUM_BROWSERS)
browser_params = [BrowserParams(display_mode= sys.argv[2] ) for _ in range(NUM_BROWSERS)]


# Update browser configuration (use this for per-browser settings)
for browser_param in browser_params:
    # Record HTTP Requests and Responses
    browser_param.http_instrument = False
    # Record cookie changes
    browser_param.cookie_instrument = False
    # Record Navigations
    browser_param.navigation_instrument = False
    # Record JS Web API calls
    browser_param.js_instrument = False
    # Record the callstack of all WebRequests made
    browser_param.callstack_instrument = False
    # Record DNS resolution
    browser_param.dns_instrument = False
    #hide_webdiver = False

    # set useragent while calibration for identification at scheduler
    if userAgent != "False":
        browser_param.change_useragent = True
        sys.stdout.write("useragent set to "+ userAgent)
    
    if proxy != "False":
        browser_param.set_proxy = True

# Update TaskManager configuration (use this for crawl-wide settings)
manager_params.data_directory = Path("./datadir/")
manager_params.log_path = Path("./datadir/openwpm.log")

# memory_watchdog and process_watchdog are useful for large scale cloud crawls.
# Please refer to docs/Configuration.md#platform-configuration-options for more information
# manager_params.memory_watchdog = False
# manager_params.process_watchdog = False


# Commands time out by default after 60 seconds
with TaskManager(
    manager_params,
    browser_params,
    SQLiteStorageProvider(Path("./datadir/crawl-data.sqlite")),
    None,
) as manager:
    # Visits the sites
    for index, site in enumerate(sites):

        def callback(success: bool, val: str = site) -> None:
            print(
                f"CommandSequence for {val} ran {'successfully' if success else 'unsuccessfully'}"
            )

 	# signalize that browser is ready for visiting URL
        sys.stdout.write("browserready")
        
        # Parallelize sites over all number of browsers set above.
        command_sequence = CommandSequence(
            site,
            site_rank=index,
            callback=callback,
        )
        
        # wait for signal that all browsers are ready
        while True:
            line = sys.stdin.readline() 
            if line == "visiturl\n":

                if waitingTime > 0:
                    sys.stdout.write("waiting " + str(waitingTime) +" seconds before websitevisit")
                    sleep(waitingTime)

                # Start by visiting the page
                command_sequence.append_command(GetCommand(url=site, sleep=1), timeout=30)
                
                command_sequence.append_command(writeDoneCommand())

                # Run commands across all browsers (simple parallelization)
                manager.execute_command_sequence(command_sequence)
                #manager.close(post_process)=False #my
                #sys.stdout.write("urldone") #new

                break
