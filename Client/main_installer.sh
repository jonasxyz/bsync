#!/bin/bash

# Main installation script for bsync-client
# Calls the individual installation modules

# Exit the script if any command fails
set -e

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
INSTALL_SCRIPTS_DIR="$SCRIPT_DIR/install_scripts"

echo "Starting bsync-client installation..."

# Module 1: Install system dependencies
echo "Module 1: Installing system dependencies"
bash "$INSTALL_SCRIPTS_DIR/01_install_system_dependencies.sh" "$@"

# Module 2: Install Node.js
echo "Module 2: Installing Node.js"
bash "$INSTALL_SCRIPTS_DIR/02_install_nodejs.sh" "$@"

# Module 3: Install Mamba
echo "Module 3: Installing Mamba"
bash "$INSTALL_SCRIPTS_DIR/03_install_mamba.sh" "$@"

# Module 4: Install mitmproxy
echo "Module 4: Installing mitmproxy"
bash "$INSTALL_SCRIPTS_DIR/04_install_mitmproxy.sh" "$@"

# Module 5: Install custom Firefox version (138.0.1)
echo "Module 5: Installing custom Firefox version (138.0.1)"
bash "$INSTALL_SCRIPTS_DIR/05_install_firefox.sh" "$@"

# Module 6: Install Puppeteer
if [[ ! " $@ " =~ " --no-puppeteer " ]]; then
    echo "Module 6: Installing Puppeteer"
    bash "$INSTALL_SCRIPTS_DIR/06_install_puppeteer.sh" "$@" "$SCRIPT_DIR" # Pass SCRIPT_DIR for paths
else
    echo "Module 6: Puppeteer installation skipped."
fi

# Module 7: Install OpenWPM
if [[ ! " $@ " =~ " --no-openwpm " ]]; then
    echo "Module 7: Installing OpenWPM"
    bash "$INSTALL_SCRIPTS_DIR/07_install_openwpm.sh" "$@" "$SCRIPT_DIR" # Pass SCRIPT_DIR for paths
else
    echo "Module 7: OpenWPM installation skipped."
fi

# Module 8: Install optional development tools
# A check for --install-devtools or similar could be implemented here
if [[ " $@ " =~ " --install-devtools " ]]; then
    echo "Module 8: Installing development tools (optional)"
    bash "$INSTALL_SCRIPTS_DIR/08_install_devtools.sh" "$@"
else
    echo "Module 8: Optional development tools installation skipped. Use --install-devtools to include them."
fi

echo "All selected installation steps are complete!" 