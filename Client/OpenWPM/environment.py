"""
Environment information utilities for OpenWPM
"""

import json
import sys
from openwpm.utilities.platform_utils import get_version


def get_environment_info():
    """Collects environment information about OpenWPM and Firefox."""
    try:
        openwpm_version, firefox_version = get_version()
        return {
            "openwpm_version": openwpm_version,
            "firefox_version": firefox_version
        }
    except Exception as e:
        sys.stderr.write(f"Error getting version info: {e}\n")
        return {
            "openwpm_version": "unknown",
            "firefox_version": "unknown"
        }


def send_crawler_env_info(additional_data=None):
    """Sends crawler environment information to stdout."""
    env_info = get_environment_info()
    
    data_to_send = {
        "user_agent": "Example User Agent",
        **env_info
    }
    
    if additional_data:
        data_to_send.update(additional_data)
    
    json_data = json.dumps(data_to_send)
    sys.stdout.write(f"CRAWLER_ENV_INFO {json_data}\n")
    sys.stdout.flush() 