#!/bin/bash

# Module 05: Install or configure custom Firefox version (134.0.1)
#
# This script can be run in two modes:
# 1. Full installation (default): Downloads, installs, and configures Firefox.
#    Usage: ./05_install_firefox.sh
# 2. Setup only: Configures an existing Firefox installation (Proxy, Extensions).
#    Usage: ./05_install_firefox.sh --setup-only

# Exit the script if any command fails
set -e

echo "Module 05: Starting installation of Firefox 134.0.1..."
# --- Configuration ---

FIREFOX_VERSION="134.0.1"
# FIREFOX_TARBALL="firefox-${FIREFOX_VERSION}.tar.xz" # for newer firefox releases 
FIREFOX_TARBALL="firefox-${FIREFOX_VERSION}.tar.bz2" # for older firefox releases (134.0.1)


# Adjust language and platform as needed. 'en-US' and 'linux-x86_64' are common defaults.
# FIREFOX_DOWNLOAD_URL="https://ftp.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/linux-x86_64/de/${FIREFOX_TARBALL}" # DE
FIREFOX_DOWNLOAD_URL="https://ftp.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/linux-x86_64/en-US/${FIREFOX_TARBALL}" # International en-US

DOWNLOAD_DIR="/tmp"
INSTALL_DIR="/opt/firefox-${FIREFOX_VERSION}"
SYMLINK_PATH="/usr/local/bin/firefox-134"

# --- Argument Parsing ---
SETUP_ONLY=false
if [[ "$1" == "--setup-only" ]]; then
    SETUP_ONLY=true
fi

# --- Script's Location and Project Root ---
# This makes the script portable by resolving paths relative to its location.
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
PROJECT_ROOT=$( cd -- "$SCRIPT_DIR/../../.." &> /dev/null && pwd )
EXTENSION_ASSETS_DIR="$PROJECT_ROOT/Client/firefox_extension/POC_firefox_extension/autoload_temporary_addon"

# --- Main Logic ---

if [ "$SETUP_ONLY" = true ]; then
    echo "Running in --setup-only mode. Skipping download and installation."
    if [ ! -d "$INSTALL_DIR" ]; then
        echo "ERROR: Firefox installation directory $INSTALL_DIR not found."
        echo "Please run the script without --setup-only first, or ensure Firefox is installed correctly."
        exit 1
    fi
else
    echo "Module 05: Starting full installation of Firefox ${FIREFOX_VERSION}..."

    # Check if this version of Firefox is already installed
    if [ -d "$INSTALL_DIR" ] && [ -x "$INSTALL_DIR/firefox" ]; then
        echo "Firefox version ${FIREFOX_VERSION} seems to be already installed in $INSTALL_DIR."
        # Optionally, check if symlink exists and points correctly
        if [ -L "$SYMLINK_PATH" ] && [ "$(readlink -f "$SYMLINK_PATH")" == "$INSTALL_DIR/firefox" ]; then
            echo "Symlink $SYMLINK_PATH already exists and is correct."
        else
            echo "Creating/Updating symlink $SYMLINK_PATH..."
            sudo ln -sf "$INSTALL_DIR/firefox" "$SYMLINK_PATH"
        fi
        echo "Skipping download and extraction."
        "$SYMLINK_PATH" --version
    else
        echo "Downloading Firefox ${FIREFOX_VERSION} from ${FIREFOX_DOWNLOAD_URL}..."
        cd "$DOWNLOAD_DIR"
        if wget -q -O "$FIREFOX_TARBALL" "$FIREFOX_DOWNLOAD_URL"; then
            echo "Download successful."
        else
            echo "ERROR: Failed to download Firefox ${FIREFOX_VERSION}. Please check the URL and your internet connection."
            exit 1
        fi

        echo "Extracting $FIREFOX_TARBALL to /opt/ ..."
        # Create target directory if it doesn't exist. /opt is standard for optional software.
        if [ ! -d "/opt" ]; then
            sudo mkdir -p "/opt"
        fi
        # Ensure the specific versioned install directory exists and is empty
        if [ -d "$INSTALL_DIR" ]; then
            echo "Removing existing installation directory: $INSTALL_DIR"
            sudo rm -rf "$INSTALL_DIR"
        fi
        sudo mkdir -p "$INSTALL_DIR" # Ensure INSTALL_DIR exists

        # Determine the correct tar options based on file extension
        if [[ "$FIREFOX_TARBALL" == *.tar.bz2 ]]; then
            EXTRACT_COMMAND="sudo tar -xjf"
        elif [[ "$FIREFOX_TARBALL" == *.tar.xz ]]; then
            EXTRACT_COMMAND="sudo tar -xJf"
        else
            echo "ERROR: Unsupported file extension for $FIREFOX_TARBALL. Must be .tar.bz2 or .tar.xz."
            sudo rm -f "$DOWNLOAD_DIR/$FIREFOX_TARBALL"
            exit 1
        fi

        echo "Extracting with command: $EXTRACT_COMMAND"
        if $EXTRACT_COMMAND "$DOWNLOAD_DIR/$FIREFOX_TARBALL" -C "$INSTALL_DIR" --strip-components=1; then
            echo "Extraction successful to $INSTALL_DIR."
        else
            echo "ERROR: Failed to extract Firefox tarball."
            sudo rm -f "$DOWNLOAD_DIR/$FIREFOX_TARBALL" # Clean up downloaded tarball
            exit 1
        fi

        echo "Cleaning up downloaded tarball..."
        sudo rm -f "$DOWNLOAD_DIR/$FIREFOX_TARBALL"

        echo "Creating symbolic link for firefox-${FIREFOX_VERSION} at $SYMLINK_PATH..."
        if sudo ln -sf "$INSTALL_DIR/firefox" "$SYMLINK_PATH"; then
            echo "Symbolic link created successfully."
        else
            echo "ERROR: Failed to create symbolic link."
            echo "You might need to create it manually: sudo ln -s $INSTALL_DIR/firefox $SYMLINK_PATH"
        fi

        echo "Verifying Firefox installation..."
        if ! "$SYMLINK_PATH" --version; then
            echo "ERROR: Firefox verification failed. Check the installation and symlink."
            exit 1
        fi
    fi
fi

# --- Firefox Configuration ---
# This part runs in both full installation and --setup-only modes.

echo "Starting Firefox configuration..."

# --- Configure Firefox to use system certificates for mitmproxy ---
# Find p11-kit-trust.so on the system to avoid hardcoded paths.
echo "Searching for p11-kit-trust.so..."
P11_KIT_TRUST_SO_PATH=$(find /usr/lib /snap -name p11-kit-trust.so 2>/dev/null | head -n 1)

LIBNSSCKBI_SO_PATH="$INSTALL_DIR/libnssckbi.so"

if [ -z "$P11_KIT_TRUST_SO_PATH" ] || [ ! -f "$P11_KIT_TRUST_SO_PATH" ]; then
    echo "WARNING: System trust store p11-kit-trust.so not found automatically."
    echo "Firefox certificate configuration will be skipped. mitmproxy may not work correctly."
    echo "Note: p11-kit is usually part of the p11-kit-modules package."
    echo "You might need to install it, e.g., 'sudo apt install p11-kit p11-kit-modules'."
else
    echo "Found system trust store at: $P11_KIT_TRUST_SO_PATH"
    echo "Configuring Firefox to use system certificates..."
    
    if [ -f "$LIBNSSCKBI_SO_PATH" ] && [ ! -L "$LIBNSSCKBI_SO_PATH" ]; then
        echo "Backing up existing Firefox trust store to $LIBNSSCKBI_SO_PATH.bak."
        sudo mv "$LIBNSSCKBI_SO_PATH" "$LIBNSSCKBI_SO_PATH.bak"
        echo "Creating symbolic link to system certificates."
        sudo ln -sf "$P11_KIT_TRUST_SO_PATH" "$LIBNSSCKBI_SO_PATH"
    elif [ -L "$LIBNSSCKBI_SO_PATH" ]; then
        echo "$LIBNSSCKBI_SO_PATH is already a symlink. Ensuring it points correctly."
        sudo ln -sf "$P11_KIT_TRUST_SO_PATH" "$LIBNSSCKBI_SO_PATH"
    else
        echo "Firefox trust store not found. Copying system trust store."
        sudo cp "$P11_KIT_TRUST_SO_PATH" "$LIBNSSCKBI_SO_PATH"
    fi
    echo "Firefox certificate configuration complete."
fi

# --- Install autoloader for bsync Firefox extension ---
echo "Installing files for automatic temporary extension loading..."

if [ ! -d "$EXTENSION_ASSETS_DIR" ]; then
    echo "ERROR: Extension assets directory not found at $EXTENSION_ASSETS_DIR"
    exit 1
fi

sudo cp "$EXTENSION_ASSETS_DIR/userChrome.js" "$INSTALL_DIR/userChrome.js"
# Ensure the target directory for config-prefs.js exists
sudo mkdir -p "$INSTALL_DIR/defaults/pref"
sudo cp "$EXTENSION_ASSETS_DIR/config-prefs.js" "$INSTALL_DIR/defaults/pref/config-prefs.js"

echo "Extension autoloader configured."

echo "Module 05: Firefox setup is complete."
echo "You can run this version using the command: $SYMLINK_PATH"
