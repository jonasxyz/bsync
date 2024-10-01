import argparse
import sys
import json
from pathlib import Path
from typing import Literal
from time import sleep

import shutil  # Added for profile cleanup
import signal  # Added for graceful shutdown

import tranco

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

data_directory = Path(args.crawldatapath)
manager_params.data_directory = data_directory
manager_params.log_path = data_directory / "openwpm.log" 


def cleanup_profile(manager):
    """Function to clean up browser profiles and properly shut down the manager."""
    sys.stdout.write("Cleaning up browser profiles...\n")
    sys.stdout.flush()

    # Close the manager first to ensure no processes are holding onto the profile directory
    manager.close()

    # Clean up the profile directories
    for browser_param in browser_params:
        if browser_param.profile_path:
            shutil.rmtree(browser_param.profile_path, ignore_errors=True)
            browser_param.profile_path = None  # Reset the profile path

    sys.stdout.write("Cleanup complete.\n")
    sys.stdout.flush()


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

    if args.reset:
        # Perform cleanup and shutdown
        cleanup_profile(manager)
        
        # Restart the manager after cleanup
        sys.stdout.write("Restarting TaskManager...\n")
        sys.stdout.flush()

        with TaskManager(
            manager_params,
            browser_params,
            SQLiteStorageProvider(data_directory / "crawl-data.sqlite"),
            None,
        ) as new_manager:
            wait_for_url(new_manager, index + 1)
    else:
        # After the URL is processed, return to waiting for the next URL
        wait_for_url(manager, index + 1)


def wait_for_url(manager, index):
    """Function to wait for a new URL command."""
    
    sys.stdout.write("browserready\n")
    sys.stdout.flush()

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
        cleanup_profile()
        return


with TaskManager(
    manager_params,
    browser_params,
    SQLiteStorageProvider(data_directory / "crawl-data.sqlite"),
    None,
) as manager:
    wait_for_url(manager, 0)
