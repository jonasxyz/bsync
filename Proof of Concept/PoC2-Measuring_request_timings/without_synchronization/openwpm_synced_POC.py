import argparse
import sys
from pathlib import Path
from typing import Literal
from time import sleep

# Copy script into location after changes
# TERMINAL: $(dirname "$(readlink -f "$0")")
# cp /home/$USER/Downloads/bsync/Client/OpenWPM/openwpm_synced.py /home/$USER/Desktop/OpenWPM/

import tranco

from custom_command import LinkCountingCommand
from openwpm.command_sequence import CommandSequence
from openwpm.commands.browser_commands import GetCommand
from openwpm.config import BrowserParams, ManagerParams
from openwpm.storage.sql_provider import SQLiteStorageProvider
from openwpm.task_manager import TaskManager

parser = argparse.ArgumentParser()
parser.add_argument("--url", type=str, default="http://www.example.com", help="URL to visit")

parser.add_argument("--tranco", action="store_true", default=False)
parser.add_argument("--headless", action="store_true", default=False)
parser.add_argument("--useragent", type=str, default=None, help="Set a custom User-Agent")
parser.add_argument("--proxyhost", type=str, default=None, help="Set the proxy host")
parser.add_argument("--proxyport", type=int, default=None, help="Set the proxy port")
parser.add_argument("--waitingtime", type=int, default=0, help="Waiting time before visiting URL")
parser.add_argument("--crawldatapath", type=str, default="./datadir/", help="set location for OpenWPMs generated crawl data")


args = parser.parse_args()

sites = [args.url]

# Debug print to check initial value of sites
# print(f"Initial value of sites: {sites}")

#if args.tranco:
#    # Load the latest tranco list. See https://tranco-list.eu/
#    print("Loading tranco top sites list...")
#    t = tranco.Tranco(cache=True, cache_dir=".tranco")
#    latest_list = t.list()
#    sites = ["http://" + x for x in latest_list.top(10)]


display_mode: Literal["native", "headless", "xvfb"] = "native"
if args.headless:
    display_mode = "headless"

# Loads the default ManagerParams
# and NUM_BROWSERS copies of the default BrowserParams
NUM_BROWSERS = 1
manager_params = ManagerParams(num_browsers=NUM_BROWSERS)
browser_params = [BrowserParams(display_mode=display_mode) for _ in range(NUM_BROWSERS)]

# Update browser configuration (use this for per-browser settings)
for browser_param in browser_params:
    # Record HTTP Requests and Responses
    browser_param.http_instrument = True
    # Record cookie changes
    browser_param.cookie_instrument = True
    # Record Navigations
    browser_param.navigation_instrument = True
    # Record JS Web API calls
    browser_param.js_instrument = True
    # Record the callstack of all WebRequests made
    # browser_param.callstack_instrument = True
    # Record DNS resolution
    browser_param.dns_instrument = True
    # Set this value as appropriate for the size of your temp directory
    # if you are running out of space
    browser_param.maximum_profile_size = 50 * (10**20)  # 50 MB = 50 * 2^20 Bytes

    # Set custom preferences if provided
    if args.useragent:
        browser_param.prefs["general.useragent.override"] = args.useragent
    if args.proxyhost and args.proxyport:
        browser_param.prefs["network.proxy.type"] = 1
        browser_param.prefs["network.proxy.ssl"] = args.proxyhost
        browser_param.prefs["network.proxy.ssl_port"] = args.proxyport


# Update TaskManager configuration (use this for crawl-wide settings)
#manager_params.data_directory = Path("./datadir/")
#manager_params.log_path = Path("./datadir/openwpm.log")

data_directory = Path(args.crawldatapath)
manager_params.data_directory = data_directory
manager_params.log_path = data_directory / "openwpm.log" 

waitingtime = args.waitingtime

# Commands time out by default after 60 seconds
with TaskManager(
    manager_params,
    browser_params,
    #SQLiteStorageProvider(Path("./datadir/crawl-data.sqlite")),
    SQLiteStorageProvider(data_directory / "crawl-data.sqlite"),
    None,
) as manager:
    # Visits the sites
    for index, site in enumerate(sites):

        def callback(success: bool, val: str = site) -> None:
            print(
                f"CommandSequence for {val} ran {'successfully' if success else 'unsuccessfully'}"
            )

        # Signalize that browser is ready for visiting URL
        sys.stdout.write("browserready\n")
        sys.stdout.flush()

        

        # Start by visiting the page
        command_sequence = CommandSequence(
            site,
            site_rank=index,
            callback=callback,
        )
        command_sequence.append_command(GetCommand(url=site, sleep=1), timeout=30)
        sys.stdout.write(f"visiting {site} \n")


        # Run commands across all browsers (simple parallelization)
        manager.execute_command_sequence(command_sequence)

        sys.stdout.write("urldone\n")
        sys.stdout.flush()
