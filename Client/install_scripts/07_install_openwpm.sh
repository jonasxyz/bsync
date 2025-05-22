#!/bin/bash

# Module 07: Install OpenWPM 

# Add the path to the Client directory as an argument if running this script directly
# ./Client/install_scripts/07_install_openwpm.sh /path/to/Client

# Exit the script if any command fails
set -e

BASE_SCRIPT_DIR="$2" # The second argument is the original SCRIPT_DIR from main_installer.sh

if [ -z "$BASE_SCRIPT_DIR" ]; then
    echo "ERROR: Base script directory was not passed to 07_install_openwpm.sh."
    exit 1
fi

echo "Module 07: Starting OpenWPM installation..."

# Check if Mamba is initialized and conda command is available
# This is a basic check. A more robust check would call 'conda env list' or similar.
if ! command -v conda &> /dev/null; then
    echo "Conda/Mamba command not found. Ensure Module 3 (Mamba installation) was successful and the shell was restarted or configuration reloaded (e.g., source ~/.bashrc)."
    echo "Attempting to activate Mamba explicitly in case it is not active in this (sub-)shell."
    
    # Attempt to activate Mamba shell hooks if they are not already active
    # This is an attempt to fix common issues after Mamba installation in scripts.
    if [ -f "/home/$USER/mambaforge/etc/profile.d/conda.sh" ]; then
        echo "Activating Mamba shell hooks..."
        source "/home/$USER/mambaforge/etc/profile.d/conda.sh"
        # After sourcing conda.sh, the conda command should be available.
        # The base environment might need to be activated explicitly.
        if ! conda env list | grep -q "base\*"; then # Checks if base is active
             echo "Activating Mamba base environment..."
             conda activate base
        fi
    else
        echo "Mamba conda.sh hook script not found. OpenWPM installation might fail."
        # exit 1 # Optional: exit here if Mamba is critical.
    fi
    
    # Re-check
    if ! command -v conda &> /dev/null; then
        echo "Conda/Mamba still not available. Please check your Mamba installation manually."
        exit 1
    fi
fi

echo "Cloning OpenWPM repository to /home/$USER/Desktop/..."
cd "/home/$USER/Desktop/"
if [ -d "OpenWPM" ]; then
    echo "OpenWPM directory already exists. Skipping clone."
else
    # git clone https://github.com/openwpm/OpenWPM.git --branch v0.28.0 # Example for specific version
    git clone https://github.com/openwpm/OpenWPM.git
fi
cd OpenWPM

# Fix potential npm permission issue
# Ensures the user has write permissions to their .npm directory.
NPM_DIR_PATH="/home/$USER/.npm"
if [ -d "$NPM_DIR_PATH" ]; then
    echo "Checking and setting permissions for $NPM_DIR_PATH (if necessary)..."
    sudo chown -R $(id -u):$(id -g) "$NPM_DIR_PATH"
else 
    echo "Note: $NPM_DIR_PATH not found, skipping chown."
fi

# The OpenWPM install.sh script expects the Conda/Mamba environment to be already active.
# The following eval lines were used in the original script and are important.
echo "Activating Mamba environment for OpenWPM installation (via eval conda shell.bash hook)..."

# Ensure hook paths are correct and files exist.
CONDA_HOOK_PATH="/home/$USER/mambaforge/bin/conda"
if [ -x "$CONDA_HOOK_PATH" ]; then # Check if the conda executable exists
    eval "$("$CONDA_HOOK_PATH" shell.bash hook)" 
    # The base environment might need to be explicitly activated here 
    # if the OpenWPM script doesn't do it itself or expects a specific environment.
    # conda activate base # Usually, auto_activate_base should handle this
else
    echo "ERROR: Mamba conda executable ($CONDA_HOOK_PATH) not found. OpenWPM installation will likely fail."
    exit 1
fi

echo "Executing OpenWPM's own installation script (./install.sh)..."
# The OpenWPM install.sh handles Conda environment creation and dependency installation.
./install.sh

# Firefox configuration for proxy use with system certificates
# Replaces OpenWPM's libnssckbi.so with a symlink to p11-kit-trust.so,
# so that Firefox used by OpenWPM uses system certificates (incl. mitmproxy CA).
OPENWPM_FIREFOX_BIN_DIR="/home/$USER/Desktop/OpenWPM/firefox-bin"
LIBNSSCKBI_SO_PATH="$OPENWPM_FIREFOX_BIN_DIR/libnssckbi.so"
P11_KIT_TRUST_SO_PATH="/usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-trust.so"

if [ -f "$LIBNSSCKBI_SO_PATH" ] && [ -f "$P11_KIT_TRUST_SO_PATH" ]; then
    echo "Configuring OpenWPM's Firefox to use system certificates (proxy use)..."
    sudo mv "$LIBNSSCKBI_SO_PATH" "$LIBNSSCKBI_SO_PATH.bak"
    sudo ln -s "$P11_KIT_TRUST_SO_PATH" "$LIBNSSCKBI_SO_PATH"
    echo "OpenWPM's Firefox has been configured."
else
    echo "WARNING: $LIBNSSCKBI_SO_PATH or $P11_KIT_TRUST_SO_PATH not found. Firefox configuration for OpenWPM skipped."
    if [ ! -f "$P11_KIT_TRUST_SO_PATH" ]; then
        echo "Note: p11-kit (and thus p11-kit-trust.so) is usually part of the p11-kit-modules package."
        echo "Check if 'sudo apt install p11-kit p11-kit-modules' might help if it's missing."
    fi
fi

# Copy the bsync crawl script to the OpenWPM directory
# The path to the script is relative to the original SCRIPT_DIR (now BASE_SCRIPT_DIR)
BSYNC_OPENWPM_SCRIPT_SOURCE="$BASE_SCRIPT_DIR/OpenWPM/openwpm_synced.py"
BSYNC_OPENWPM_SCRIPT_DEST="/home/$USER/Desktop/OpenWPM/openwpm_synced.py"

if [ -f "$BSYNC_OPENWPM_SCRIPT_SOURCE" ]; then
    echo "Copying bsync OpenWPM script ($BSYNC_OPENWPM_SCRIPT_SOURCE) to ($BSYNC_OPENWPM_SCRIPT_DEST)..."
    cp "$BSYNC_OPENWPM_SCRIPT_SOURCE" "$BSYNC_OPENWPM_SCRIPT_DEST"
    echo "bsync OpenWPM script copied."
else
    echo "WARNING: bsync OpenWPM script ($BSYNC_OPENWPM_SCRIPT_SOURCE) not found. Copying skipped."
fi

cd "$BASE_SCRIPT_DIR/.." # Back to the original working directory or a safe location

echo "Module 07: OpenWPM installation complete." 