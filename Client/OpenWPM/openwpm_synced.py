"""
OpenWPM Synchronised Crawler
============================

Based on https://github.com/openwpm/OpenWPM/demo.py
Modified for use in the bsync synchronisation framework


This script runs as subprocess and communicates via stdin/stdout.
"""

import argparse
import sys
import json
import signal
import time
from pathlib import Path
from typing import Literal
from time import sleep
import atexit

from openwpm.command_sequence import CommandSequence
from openwpm.commands.browser_commands import GetCommand
from openwpm.config import BrowserParams, ManagerParams
from openwpm.storage.sql_provider import SQLiteStorageProvider
from openwpm.task_manager import TaskManager
from openwpm.commands.types import BaseCommand
from openwpm.commands.utils.webdriver_utils import wait_until_loaded

# Local environment functions
# from environment import get_environment_info


# ===== CONFIGURATION =====
# These variables can be adjusted directly in the script:

# Screen resolution for browser window
SCREEN_WIDTH = 800   # Default: 1366
SCREEN_HEIGHT = 600   # Default: 768

# Page Load Timeout for webdriver in seconds  
PAGE_LOAD_TIMEOUT = 30  # Default: 30
# If setting the webdriver timeout lower than the page load timeout, sites that timeout wont be counted as timeouts

# Timeout for OpenWPM GetCommand that visits a page in seconds
VISIT_PAGE_TIMEOUT = 30 # Default: 30
# ========================


class WaitForDoneCommand(BaseCommand):
    """A custom command that waits until the page is fully loaded."""
    
    def __init__(self, url=None, timeout=30, additional_wait=0):
        self.url = url
        self.timeout = timeout
        self.additional_wait = additional_wait
    
    def __repr__(self):
        return f"WaitForDoneCommand(timeout={self.timeout}, additional_wait={self.additional_wait})"
    
    def execute(self, webdriver, browser_params, manager_params, extension_socket):
        """Waits until the page is fully loaded."""
        try:
            # Safe version of wait_until_loaded that doesn't block
            loaded = self._safe_wait_until_loaded(webdriver, self.timeout)
            
            if not loaded:
                log_message(f"Page did not load completely within {self.timeout} seconds", "WARNING")
            
            # URL_DONE signal is now sent here when the website is actually finished
            if self.url:
                sys.stdout.write(f"URL_DONE: {self.url}\n")
            else:
                sys.stdout.write("URL_DONE\n")
            sys.stdout.flush()

            # Additional wait time for dynamic content
            if self.additional_wait > 0:
                time.sleep(self.additional_wait)
                
        except Exception as e:
            log_message(f"WaitForDoneCommand error: {e}", "WARNING")
            # Send URL_DONE so that the crawler can continue
            if self.url:
                sys.stdout.write(f"URL_DONE: {self.url}\n")
            else:
                sys.stdout.write("URL_DONE\n")
            sys.stdout.flush()
    
    def _safe_wait_until_loaded(self, webdriver, timeout, period=0.25):
        """Safe version of wait_until_loaded that catches WebDriverExceptions."""
        start_time = time.time()
        mustend = time.time() + timeout
        
        while time.time() < mustend:
            try:
                # Try to check document.readyState
                ready_state = webdriver.execute_script("return document.readyState")
                if ready_state == "complete":
                    return True
            except Exception as e:
                # If execute_script fails, the browser is probably in a
                # problematic state. Log it and return False.
                log_message(f"execute_script failed in _safe_wait_until_loaded: {e}", "DEBUG")
                return False
            
            time.sleep(period)
        
        return False


def log_message(message, level="INFO"):
    """Helper function for structured logging."""
    sys.stdout.write(f"[{level}] {message}\n")
    sys.stdout.flush()


def parse_command_data(line, command_prefix):
    """Parses JSON data from a command string."""
    try:
        json_part = line[len(command_prefix):].strip()
        return json.loads(json_part)
    except json.JSONDecodeError as e:
        log_message(f"JSON parsing error: {e}", "ERROR")
        return None


class OpenWPMCrawler:
    """Main class for the OpenWPM crawler."""
    
    def __init__(self, args):
        self.args = args
        self.manager = None
        self.num_browsers = 1
        
        # Configure screen resolution and page load timeout first
        self.screen_width = getattr(self.args, 'screen_width', SCREEN_WIDTH)
        self.screen_height = getattr(self.args, 'screen_height', SCREEN_HEIGHT)
        self.page_load_timeout = getattr(self.args, 'page_load_timeout', PAGE_LOAD_TIMEOUT)
        
        # Create configuration
        self.manager_params = ManagerParams(num_browsers=self.num_browsers)
        self.browser_params = self._create_browser_params()
        self._setup_data_directory()
        
        # Register signal handlers
        signal.signal(signal.SIGTERM, self._on_shutdown)
        signal.signal(signal.SIGINT, self._on_shutdown)

    #     # Register atexit handler for graceful shutdown
    #     atexit.register(self._ensure_shutdown_on_exit)
    
    # def _ensure_shutdown_on_exit(self):
    #     """Ensures manager.close() is called on normal program termination."""
    #     if self.manager:
    #         log_message("atexit: Ensuring TaskManager is closed.", "INFO")
    #         self.manager.close(relaxed=False)
    #     else:
    #         log_message("atexit: TaskManager not initialized, no explicit close needed via atexit.", "INFO")
    
    def _create_browser_params(self):
        """Creates and configures browser parameters."""
        display_mode: Literal["native", "headless", "xvfb"] = (
            "headless" if self.args.headless else "native"
        )
        
        browser_params = [
            BrowserParams(display_mode=display_mode) 
            for _ in range(self.num_browsers)
        ]
        
        # Apply browser configuration
        for browser_param in browser_params:
            self._configure_browser_param(browser_param)
        
        return browser_params
    
    def _configure_browser_param(self, browser_param):
        """Configures a single browser parameter."""
        # Disable OpenWPM instrumentation
        browser_param.http_instrument = False
        browser_param.cookie_instrument = False
        browser_param.navigation_instrument = False
        browser_param.js_instrument = False
        browser_param.dns_instrument = False
        
        # Limit profile size
        browser_param.maximum_profile_size = 50 * (10**20)  # 50 MB

        # Configure custom profile path if provided
        if self.args.browserprofilepath:
            custom_profile_dir = Path(self.args.browserprofilepath)
            custom_profile_dir.mkdir(parents=True, exist_ok=True) # Ensure the directory exists
            
            # Define the path for the live Firefox profile to be used directly
            live_profile_direct_path = custom_profile_dir
            browser_param.profile_to_use_directly = live_profile_direct_path
            log_message(f"Firefox will use profile directly from: {live_profile_direct_path}")

            # Set the profile archive directory to the main custom path (for backups by OpenWPM)
            browser_param.profile_archive_dir = custom_profile_dir
            log_message(f"OpenWPM will save profile archives to: {custom_profile_dir}")

            # Attempt to find an existing profile archive in the main custom path 
            # to use for initializing the direct profile if it's empty.
            profile_tar_files = []
            if custom_profile_dir.exists() and custom_profile_dir.is_dir():
                for f_item in custom_profile_dir.iterdir():
                    if f_item.is_file() and (f_item.name.endswith(".tar") or f_item.name.endswith(".tar.gz")):
                        profile_tar_files.append(f_item)
            
            if profile_tar_files:
                # Sort by modification time, newest first
                profile_tar_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
                latest_profile_tar = profile_tar_files[0]
                # This tar will be used by deploy_firefox.py to initialize the direct profile if it's empty
                browser_param.seed_tar_for_direct_profile_init = latest_profile_tar
                log_message(f"Found latest profile archive for potential direct profile initialization: {latest_profile_tar}")
                # We no longer set browser_param.seed_tar here, as the direct profile initialization handles it.
                # browser_param.seed_tar = latest_profile_tar 
            else:
                log_message(f"No existing profile archive found in {custom_profile_dir}. If direct profile is empty, it will start fresh.")
        
        
        # Set custom parameters for screen resolution and page load timeout
        browser_param.custom_params['screen_width'] = self.screen_width
        browser_param.custom_params['screen_height'] = self.screen_height
        browser_param.custom_params['page_load_timeout'] = self.page_load_timeout

        # Configure screen resolution via Firefox preferences (fallback)
        #browser_param.prefs["browser.window.width"] = self.screen_width
        #browser_param.prefs["browser.window.height"] = self.screen_height
        
        # Proxy configuration if provided
        if self.args.proxyhost and self.args.proxyport:
            self._configure_proxy(browser_param)
        
        # Disable cache
        browser_param.prefs["browser.cache.disk.enable"] = False
        browser_param.prefs["browser.cache.memory.enable"] = False
        
        log_message(f"Browser parameters configured - Resolution: {self.screen_width}x{self.screen_height}, Page load timeout: {self.page_load_timeout}s")
    
    def _configure_proxy(self, browser_param):
        """Configures proxy settings."""
        browser_param.prefs["network.proxy.type"] = 1
        browser_param.prefs["network.proxy.http"] = self.args.proxyhost
        browser_param.prefs["network.proxy.http_port"] = self.args.proxyport
        browser_param.prefs["network.proxy.ssl"] = self.args.proxyhost
        browser_param.prefs["network.proxy.ssl_port"] = self.args.proxyport
        browser_param.prefs["network.proxy.socks"] = self.args.proxyhost
        browser_param.prefs["network.proxy.socks_port"] = self.args.proxyport
        browser_param.prefs["network.proxy.socks_version"] = 5
        browser_param.prefs["network.proxy.socks_remote_dns"] = True
        browser_param.prefs["network.proxy.share_proxy_settings"] = True
        
        log_message(f"Proxy configured: {self.args.proxyhost}:{self.args.proxyport}")
    
    def _setup_data_directory(self):
        """Sets up the data directory."""
        data_directory = Path(self.args.crawldatapath)
        self.manager_params.data_directory = data_directory
        self.manager_params.log_path = data_directory / "openwpm.log"
        self.data_directory = data_directory
    
    def _on_shutdown(self, signal_received, frame):
        """Handles graceful shutdown."""
        log_message("Graceful shutdown signal received", "INFO")
        if self.manager:
            self.manager.close()
        sys.exit(0)
    
    def _wait_for_browser_ready(self, browser_id, timeout=60):
        """Waits until browser is ready."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            # Ensure browsers exist and browser_id is valid
            if (hasattr(self.manager, 'browsers') and 
                self.manager.browsers is not None and 
                browser_id < len(self.manager.browsers) and
                self.manager.browsers[browser_id] is not None):
                
                # Original ready() method from BrowserManagerHandle
                browser = self.manager.browsers[browser_id]
                if browser.ready():
                    log_message(f"Browser {browser_id} ready")
                    return True
            else:
                log_message(f"Browser {browser_id} not yet initialized", "DEBUG")
            
            time.sleep(0.5)
        
        log_message(f"Browser {browser_id} not ready after {timeout}s", "ERROR")
        return False
    
    def _check_all_browsers_ready(self):
        """Checks if all browsers are ready."""
        all_ready = True
        for browser_id in range(self.num_browsers):
            if not self._wait_for_browser_ready(browser_id):
                all_ready = False
        
        if all_ready:
            sys.stdout.write("browser_ready\n")
            sys.stdout.flush()
        
        return all_ready
    
    def _visit_url(self, url, wait_time=0, visit_duration=3):
        """Visits a URL with specified parameters."""

        # Validate wait_time and set to 0 if invalid
        if not isinstance(wait_time, (int, float)) or wait_time < 0:
            wait_time = 0
            log_message("Invalid wait_time, setting to 0", "WARNING")
            
        if wait_time > 0:
            log_message(f"Waiting {wait_time}ms before URL visit")
            sleep(wait_time / 1000)
        
        # Create inline callback
        def callback(success: bool, error_info: dict = None) -> None:
            if success:
                log_message(f"URL {url} visited successfully")
                print(f"CommandSequence for {url} ran successfully")

                # Could Send URL_DONE here, but it's too late to be accurate.
                # Instead, we send it in the WaitForDoneCommand.
                #sys.stdout.write(f"URL_DONE:{url}\n")
                #sys.stdout.flush()
            else:
                if error_info:
                    error_type = error_info.get("error_type", "unknown")
                    error_text = error_info.get("error_text", "")
                    log_message(f"Error visiting {url}: {error_type} - {error_text}", "ERROR")
                    print(f"CommandSequence for {url} ran unsuccessfully: {error_type}")
                    
                    # Output specific error information for the controlling script
                    sys.stdout.write(f"ERROR_TYPE:{error_type}\n")
                    sys.stdout.write(f"ERROR_TEXT:{error_text}\n")
                    sys.stdout.flush()
                else:
                    log_message(f"Error visiting {url}", "ERROR")
                    print(f"CommandSequence for {url} ran unsuccessfully")
            
            sys.stdout.write("BROWSER_FINISHED\n")
            sys.stdout.flush()
        
        # Create CommandSequence
        command_sequence = CommandSequence(
            url,
            site_rank=0,
            callback=callback,
        )
        
        # Add GetCommand
        command_sequence.append_command(
            GetCommand(url=url, sleep=visit_duration), 
            timeout=VISIT_PAGE_TIMEOUT
        )
        
        # Append WaitForDoneCommand to command sequence to signal when the page was loaded
        command_sequence.append_command(
            WaitForDoneCommand(url=url, timeout=2, additional_wait=0), 
            timeout=5 # TODO: appropriate timeout
        )
        
        log_message(f"Visiting URL: {url}")
        
        # Execute
        self.manager.execute_command_sequence(command_sequence)
        
        # URL_DONE Signal removed
        #sys.stdout.write("URL_DONE\n")
        #sys.stdout.flush()
    
    def _restart_browsers(self, clear_profile=False):
        """Restarts all browsers."""
        success_count = 0
        
        for browser_id in range(self.num_browsers):
            try:
                success = self.manager.browsers[browser_id].restart_browser_manager(
                    clear_profile=clear_profile
                )
                if success:
                    log_message(f"Browser {browser_id} restarted successfully")
                    success_count += 1
                else:
                    log_message(f"Failed to restart browser {browser_id}", "ERROR")
            except Exception as e:
                log_message(f"Error restarting browser {browser_id}: {e}", "ERROR")
        
        # Check browser readiness
        self._check_all_browsers_ready()
        
        return success_count == self.num_browsers
    
    def _handle_visit_url_command(self, line):
        """Handles visit_url commands."""
        data = parse_command_data(line, "visit_url")
        if not data:
            return
        
        url = data.get("url")
        wait_time = data.get("waitingTime", 0)
        visit_duration = data.get("visitDuration", 3)
        
        if not url:
            log_message("No valid URL in visit_url command", "ERROR")
            return
        
        log_message(f"visit_url signal received: {url}, waiting time: {wait_time}, visit duration: {visit_duration}")
        self._visit_url(url, wait_time, visit_duration)
    
    def _process_stdin_command(self, line):
        """Processes a single stdin command."""
        line = line.strip()
        
        if line.startswith("visit_url"):
            self._handle_visit_url_command(line)
            
        elif line == "exit":
            log_message("Exit command received")
            return False  # Ends main loop
            
        elif line == "restart":
            log_message("Restart command received")
            self._restart_browsers(clear_profile=False)
            
        elif line == "reset":
            log_message("Reset command received")
            self._restart_browsers(clear_profile=True)
            
        elif line == "check_readiness":
            sys.stdout.write("browser_ready\n")
            sys.stdout.flush()
            
        else:
            log_message(f"Unknown command: {line}", "WARNING")
        
        return True
    
    def run(self):
        """Main execution of the crawler."""
        # Output environment info not implemented yet
        # env_info = get_environment_info()
        # log_message(f"OpenWPM Version: {env_info['openwpm_version']}")
        # log_message(f"Firefox Version: {env_info['firefox_version']}")
        
        # Start TaskManager
        with TaskManager(
            self.manager_params,
            self.browser_params,
            SQLiteStorageProvider(self.data_directory / "crawl-data.sqlite"),
            None,
        ) as manager:
            self.manager = manager
            
            log_message("TaskManager started")
            
            # Check browser readiness
            self._check_all_browsers_ready()
            
            # Main loop for stdin commands
            try:
                for line in sys.stdin:
                    if not self._process_stdin_command(line):
                        break  # Exit command received
                        
            except KeyboardInterrupt:
                log_message("KeyboardInterrupt received", "INFO")
            except Exception as e:
                log_message(f"Unexpected error: {e}", "ERROR")
            finally:
                log_message("TaskManager shutting down")
                manager.close(relaxed=False)


def main():
    """Main function."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", action="store_true", default=False)
    parser.add_argument("--crawldatapath", type=str, default="./datadir/")
    parser.add_argument("--proxyhost", type=str, default=None)
    parser.add_argument("--proxyport", type=int, default=None)

    parser.add_argument("--screen_width", type=int, default=SCREEN_WIDTH, help="Browser window width")
    parser.add_argument("--screen_height", type=int, default=SCREEN_HEIGHT, help="Browser window height")
    parser.add_argument("--page_load_timeout", type=int, default=PAGE_LOAD_TIMEOUT, help="Page load timeout in seconds")

    parser.add_argument("--browserprofilepath", type=str, default=None, 
                       help="Custom base path for browser profiles")
    
    args = parser.parse_args()
    crawler = OpenWPMCrawler(args)
    crawler.run()


if __name__ == "__main__":
    main() 