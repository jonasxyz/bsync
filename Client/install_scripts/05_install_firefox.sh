#!/bin/bash

# Module 05: Install custom Firefox version (138.0.1)

# Exit the script if any command fails
set -e

echo "Module 05: Starting installation of Firefox 138.0.1..."

FIREFOX_VERSION="138.0.1"
FIREFOX_TARBALL="firefox-${FIREFOX_VERSION}.tar.xz"
# Adjust language and platform as needed. 'en-US' and 'linux-x86_64' are common defaults.
FIREFOX_DOWNLOAD_URL="https://ftp.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/linux-x86_64/de/${FIREFOX_TARBALL}" # DE
# FIREFOX_DOWNLOAD_URL="https://ftp.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/linux-x86_64/en-US/${FIREFOX_TARBALL}" # International en-US

DOWNLOAD_DIR="/tmp" 
INSTALL_DIR="/opt/firefox-${FIREFOX_VERSION}"
SYMLINK_PATH="/usr/local/bin/firefox-138"

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
    echo "Module 05: Firefox ${FIREFOX_VERSION} is already set up."
    exit 0
fi

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

if sudo tar -xJf "$DOWNLOAD_DIR/$FIREFOX_TARBALL" -C "$INSTALL_DIR" --strip-components=1; then
    echo "Extraction successful to $INSTALL_DIR."
else
    echo "ERROR: Failed to extract Firefox tarball."
    sudo rm -f "$DOWNLOAD_DIR/$FIREFOX_TARBALL" # Clean up downloaded tarball
    exit 1
fi

echo "Cleaning up downloaded tarball..."
sudo rm -f "$DOWNLOAD_DIR/$FIREFOX_TARBALL"

echo "Creating symbolic link for firefox-${FIREFOX_VERSION} at $SYMLINK_PATH..."
# -s for symbolic, -f to force (overwrite if exists)
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

echo "Module 05: Firefox ${FIREFOX_VERSION} installation complete."
echo "You can run this version using the command: $SYMLINK_PATH" 