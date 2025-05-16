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
parser.add_argument("--stay", type=int, default=3, help="Seconds the browser stays on the webpage")

parser.add_argument("--proxyhost", type=str, default=None, help="Set the proxy host")
parser.add_argument("--proxyport", type=int, default=None, help="Set the proxy port")

args = parser.parse_args()

display_mode: Literal["native", "headless", "xvfb"] = "native"
if args.headless:
    display_mode = "headless"

# Loads the default manager params
NUM_BROWSERS = 1
manager_params = ManagerParams(num_browsers=NUM_BROWSERS)
browser_params = [BrowserParams(display_mode=display_mode) for _ in range(NUM_BROWSERS)]


data_directory = Path(args.crawldatapath)
manager_params.data_directory = data_directory
manager_params.log_path = data_directory / "openwpm.log" 

# Initialize the TaskManager
manager = TaskManager(
    manager_params,
    browser_params,
    SQLiteStorageProvider(data_directory / "crawl-data.sqlite"),
    None,
)

def process_url(manager, url, useragent=None, waitingtime=0):
    """Function to process a single URL."""
    
    if useragent:
        for browser_param in manager.browser_params:
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
        site_rank=0,  # Since we're processing one URL at a time, site_rank can be 0
        callback=callback,
    )
    command_sequence.append_command(GetCommand(url=url, sleep=3), timeout=30)
    sys.stdout.write(f"visiting {url}\n")

    # Run commands across all browsers (simple parallelization)
    manager.execute_command_sequence(command_sequence)

    sys.stdout.write("urldone\n")
    sys.stdout.flush()

def wait_for_url(manager):
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
                process_url(manager, url, useragent, waitingtime)
            else:
                sys.stdout.write("Invalid URL\n")
                sys.stdout.flush()
        except json.JSONDecodeError:
            sys.stdout.write("Failed to decode JSON\n")
            sys.stdout.flush()

    elif line == "exit":
        sys.stdout.write("exiting\n")
        sys.stdout.flush()
        manager.close()
        sys.exit(0)

# Main loop to continually process URLs
try:
    while True:
        wait_for_url(manager)
except Exception as e:
    sys.stdout.write(f"Error: {e}\n")
    sys.stdout.flush()
    manager.close()