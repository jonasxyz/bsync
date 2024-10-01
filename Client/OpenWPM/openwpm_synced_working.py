#****************************************************************************
# openwpm_synced.py
#
# based on https://github.com/openwpm/OpenWPM/demo.py
# modified for use in the bsync synchronisation framework
#
#****************************************************************************

import argparse
import sys
import json
from pathlib import Path
from typing import Literal
from time import sleep

import shutil  # Added for profile cleanup
import signal  # Added for graceful shutdown

import time

from custom_command import LinkCountingCommand
from openwpm.command_sequence import CommandSequence
from openwpm.commands.browser_commands import GetCommand
from openwpm.config import BrowserParams, ManagerParams
from openwpm.storage.sql_provider import SQLiteStorageProvider
from openwpm.task_manager import TaskManager

parser = argparse.ArgumentParser()
parser.add_argument("--headless", action="store_true", default=False)
parser.add_argument("--crawldatapath", type=str, default="./datadir/", help="set location for OpenWPMs generated crawl data")
parser.add_argument("--reset", action="store_true", default=False, help="Reset the browser after each visit")

parser.add_argument("--stay", type=int, default=3, help="time to stay on each page")


parser.add_argument("--proxyhost", type=str, default=None, help="Set the proxy host")
parser.add_argument("--proxyport", type=int, default=None, help="Set the proxy port")


args = parser.parse_args()

display_mode: Literal["native", "headless", "xvfb"] = "native"
if args.headless:
    display_mode = "headless"

# Loads the default ManagerParams
NUM_BROWSERS = 1
manager_params = ManagerParams(num_browsers=NUM_BROWSERS)
browser_params = [BrowserParams(display_mode=display_mode) for _ in range(NUM_BROWSERS)]

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
    # browser_param.callstack_instrument = True
    # Record DNS resolution
    browser_param.dns_instrument = False
    # Set this value as appropriate for the size of your temp directory
    # if you are running out of space
    browser_param.maximum_profile_size = 50 * (10**20)  # 50 MB = 50 * 2^20 Bytes

    # Set custom preferences if provided
    #if args.useragent:
    #    browser_param.prefs["general.useragent.override"] = args.useragent
    if args.proxyhost and args.proxyport:
        browser_param.prefs["network.proxy.type"] = 1
        browser_param.prefs["network.proxy.ssl"] = args.proxyhost
        browser_param.prefs["network.proxy.ssl_port"] = args.proxyport

     # TODO temp preferences
    browser_param.prefs["browser.cache.disk.enable"] = False
    browser_param.prefs["browser.cache.memory.enable"] = False

    sys.stdout.write("Browser parameters set.\n")
    sys.stdout.flush()



data_directory = Path(args.crawldatapath)
manager_params.data_directory = data_directory
manager_params.log_path = data_directory / "openwpm.log" 

def cleanup_profile(manager):
    """Function to clean up browser profiles and properly shut down the manager."""
    sys.stdout.write("Cleaning up browser profiles...\n")
    sys.stdout.flush()

    # Clean up the profile directories
    for browser_param in browser_params:
        if browser_param.profile_path:
            shutil.rmtree(browser_param.profile_path, ignore_errors=True)
            # browser_param.profile_path = None  # Reset the profile path

    sys.stdout.write("Cleanup complete.\n")
    sys.stdout.flush()

# Function to handle graceful shutdown
def on_shutdown(signal_received, frame):
    manager.close()
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGTERM, on_shutdown)
signal.signal(signal.SIGINT, on_shutdown)

# Commands time out by default after 60 seconds
def process_url(manager, url, useragent=None, waitingtime=0, index=0):
    """Function to process a single URL and then return to waiting state."""
    
    if useragent:
        for browser_param in browser_params:
            browser_param.prefs["general.useragent.override"] = useragent
    
    def callback(success: bool, val: str = url) -> None:
        print(
            f"CommandSequence for {val} ran {'successfully' if success else 'unsuccessfully'}"
        )
        if not success:
            sys.stdout.write("CommandSequence ran unsuccessfully\n")
            sys.stdout.flush()
        #else:
            # After the URL is processed, return to waiting for the next URL
            #wait_for_url(manager, index + 1)
            # After the URL is processed, return to waiting for the next URL
            #if args.reset:
            #    for browser_id in range(NUM_BROWSERS):
            #        if not restart_browser(manager, browser_id):
            #            sys.stdout.write(f"Failed to restart browser {browser_id}. Exiting.\n")
            #            sys.stdout.flush()
            #            #cleanup_profile(manager)
            #            sys.exit(1)
            #sys.stdout.write("All browsers restarted successfully.\n")
            #sys.stdout.flush()
            #wait_for_url(manager, index + 1)

    if waitingtime > 0:
        sys.stdout.write(f"waiting {waitingtime} ms before website visit\n")
        sys.stdout.flush()
        sleep(waitingtime / 1000)

    # Start by visiting the page
    command_sequence = CommandSequence(
        url,
        reset=args.reset,
        site_rank=index,
        callback=callback,
    )
    command_sequence.append_command(GetCommand(url=url, sleep=3), timeout=30)
    sys.stdout.write(f"visiting {url}\n")

    # Run commands across all browsers (simple parallelization)
    manager.execute_command_sequence(command_sequence)

    sys.stdout.write("urldone\n")
    sys.stdout.flush()



def restart_browser(manager, browser_id):
    """Function to restart the browser with retries."""
    max_retries = 3
    for attempt in range(max_retries):
        manager.logger.info(f"Attempting to restart browser {browser_id}, attempt {attempt + 1}")
        try:
            manager.browser_manager.restart_browser(browser_id, clear_profile=True)
            manager.logger.info(f"Browser {browser_id} restarted successfully on attempt {attempt + 1}")
            return True
        except Exception as e:
            manager.logger.error(f"Failed to restart browser {browser_id} on attempt {attempt + 1}: {e}")
            sleep(2)  # small delay before retrying
    manager.logger.critical(f"Exceeded maximum retries ({max_retries}) to restart browser {browser_id}")
    return False


def wait_for_url(manager, index):
    """Function to wait for a new URL command."""
    
    sys.stdout.write("browserready\n")
    sys.stdout.flush()

    while True:
        # Wait for signal and URL
        line = sys.stdin.readline().strip()
        if line.startswith("visiturl"):
            try:
                # Parse the JSON object passed with visiturl
                data = json.loads(line[len("visiturl "):])
                url = data.get("url")
                useragent = data.get("useragent")
                waitingtime = data.get("waitingtime", 0)

                if url:
                    # Process the URL
                    process_url(manager, url, useragent, waitingtime, index)
                else:
                    sys.stdout.write("Invalid URL\n")
                    sys.stdout.flush()
            except json.JSONDecodeError:
                sys.stdout.write("Failed to decode JSON\n")
                sys.stdout.flush()

        elif line == "exit":
            sys.stdout.write("Exiting\n")
            sys.stdout.flush()
            manager.close() # (relaxed=False)
            #cleanup_profile(manager)
            return


def wait_for_browser_ready(manager, browser_id, timeout=60):
    """Wait for the browser to be ready."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        if manager.browsers[browser_id].ready():
            sys.stdout.write("browser_ready\n")
            sys.stdout.flush()
            return True
        time.sleep(0.5)
    return False # Todo browser restart timeout message and handling

def check_browsers_ready(manager):
    """Check if all browsers are ready and signal for each."""
    all_ready = True
    for browser_id in range(NUM_BROWSERS):
        if not wait_for_browser_ready(manager, browser_id):
            all_ready = False
            print(f"Browser {browser_id} is not ready")
    return all_ready

with TaskManager(
    manager_params,
    browser_params,
    SQLiteStorageProvider(data_directory / "crawl-data.sqlite"),
    None,
) as manager:
    sys.stdout.write("as Manager called\n")

    check_browsers_ready(manager)

    # Main loop to process stdin commands
    for line in sys.stdin: # try only loop when stdin input
        line = line.strip()
        if line.startswith("visiturl"):
    # Continuously read URLs from stdin and process them
    # while True:
    #     line = sys.stdin.readline().strip()
    #     if line.startswith("visiturl"):
            try:
                # Parse the JSON object passed with visiturl
                data = json.loads(line[len("visiturl "):])
                url = data.get("url")
                useragent = data.get("useragent")
                waitingtime = data.get("waitingtime", 0)

                if url:
                    def callback(success: bool, val: str = url) -> None:
                        print(
                            f"CommandSequence for {val} ran {'successfully' if success else 'unsuccessfully'}"
                        )
                        if not success:
                            sys.stdout.write("CommandSequence ran unsuccessfully\n")
                            sys.stdout.flush()
                        else:
                            # After the URL is processed
                            sys.stdout.write("browserfinished\n")
                            sys.stdout.flush()

                    # Signalize that browser is ready for visiting URL
                    sys.stdout.write("browserready\n")
                    sys.stdout.flush()
                    
                    # Create a CommandSequence for the provided URL
                    command_sequence = CommandSequence(
                        url,
                        reset=args.reset,
                        #blocking=True,
                        site_rank=0,  # Site rank is not important here, so setting to 0
                        callback=callback,
                    )

                    # Visit the page
                    command_sequence.append_command(GetCommand(url=url, sleep=args.stay), timeout=60)

                    sys.stdout.write(f"visiting {url}\n")
                    # Execute the command sequence
                    manager.execute_command_sequence(command_sequence)

            except json.JSONDecodeError:
                print("Failed to parse JSON from input. Please ensure it's correctly formatted.")

        elif line == "exit":
            sys.stdout.write("Exiting\n")
            sys.stdout.flush()
            manager.close(relaxed=False) 
            # manager.close() # (relaxed=True) # wait for all active `CommandSequences` to finish before shutting down
            # cleanup_profile(manager)

        elif line == "restart":
                # Restart the browser manager for all browsers
                for browser_id in range(NUM_BROWSERS):
                    success = manager.browsers[browser_id].restart_browser_manager()
                    if success:
                        print(f"Browser {browser_id} restarted successfully")
                    else:
                        print(f"Failed to restart browser {browser_id}")
                check_browsers_ready(manager)


        elif line == "reset":
                # Restart the browser manager for all browsers and clear the profile
                for browser_id in range(NUM_BROWSERS):
                    success = manager.browsers[browser_id].restart_browser_manager(clear_profile=True)
                    if success:
                        print(f"Browser {browser_id} restarted successfully")
                    else:
                        print(f"Failed to restart browser {browser_id}")
                check_browsers_ready(manager)
