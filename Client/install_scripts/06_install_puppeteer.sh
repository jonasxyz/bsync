#!/bin/bash

# Module 06: Install Puppeteer

# Add the path to the Client directory as an argument if running this script directly
# ./Client/install_scripts/06_install_puppeteer.sh /path/to/Client

# Exit the script if any command fails
set -e

BASE_SCRIPT_DIR="$2" # The second argument is the original SCRIPT_DIR from main_installer.sh

if [ -z "$BASE_SCRIPT_DIR" ]; then
    echo "ERROR: Base script directory was not passed to 06_install_puppeteer.sh."
    exit 1
fi 

echo "Module 06: Starting Puppeteer core installation..."

# Check if Node.js and npm are installed
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "Node.js or npm not found. Please ensure Module 2 (Node.js installation) was successful."
    exit 1
fi

# The path to the Client directory, relative to the original install.sh (now main_installer.sh)
# Since this script is in install_scripts/, BASE_SCRIPT_DIR is the Client directory.
PUPPETEER_DEPENDENCIES_DIR="$BASE_SCRIPT_DIR"
# The actual Puppeteer script directory is then BASE_SCRIPT_DIR/puppeteer
PUPPETEER_SCRIPT_DIR="$BASE_SCRIPT_DIR/puppeteer"

echo "Installing npm packages for Puppeteer in directory $PUPPETEER_DEPENDENCIES_DIR"
cd "$PUPPETEER_DEPENDENCIES_DIR"
sudo npm install # Installs dependencies defined in package.json in the Client folder

if [ ! -d "$PUPPETEER_SCRIPT_DIR" ]; then
    echo "ERROR: Puppeteer script directory ($PUPPETEER_SCRIPT_DIR) not found."
    # Optional: mkdir -p "$PUPPETEER_SCRIPT_DIR" if it is expected to be created here.
    exit 1
fi

# Firefox for Puppeteer is expected to be installed by a separate module (e.g., Module 05).
# Puppeteer will need to be configured to use the specific Firefox executable in config.js,
echo "Puppeteer will attempt to use the installed Firefox version."

# Navigate to Puppeteer script directory for puppeteer_synced.js
cd "$PUPPETEER_SCRIPT_DIR"

# Not needed for Firefox for now
# Start puppeteer for generating CA cert destination
# if [ -f "puppeteer_synced.js" ]; then
#     echo "Starting puppeteer_synced.js temporarily (e.g., for profile creation/certificate location)..."
#     node puppeteer_synced.js & # Starts in the background
#     PUPPETEER_PID=$!
#     echo "Waiting 5 seconds for puppeteer_synced.js to perform operations..."
#     sleep 5

#     if ps -p $PUPPETEER_PID > /dev/null; then
#         echo "Stopping puppeteer_synced.js (PID: $PUPPETEER_PID)..."
#         kill $PUPPETEER_PID
#         sleep 2
#         if ps -p $PUPPETEER_PID > /dev/null; then
#             echo "puppeteer_synced.js process could not be terminated gracefully. Sending SIGKILL..."
#             kill -9 $PUPPETEER_PID
#         fi
#     else
#         echo "puppeteer_synced.js seems to have already terminated or was not started correctly."
#     fi
# else
#     echo "WARNING: puppeteer_synced.js not found in directory $PUPPETEER_SCRIPT_DIR. Skipping temporary start."
# fi



# Add mitmproxy SSL certificate into Chromium Trusted CA Storage if needed

# MITMPROXY_CA_CERT_SYSTEM_PATH="/usr/local/share/ca-certificates/mitmproxy-ca-cert.crt"
# USER_NSSDB_PATH="$HOME/.pki/nssdb"

# # CA certificate only needed for Chrome/Chromium browsers
# if [ -f "$MITMPROXY_CA_CERT_SYSTEM_PATH" ]; then 
#     if [ -d "$USER_NSSDB_PATH" ]; then
#         echo "Installing libnss3-tools to manage CA certificates in the NSS database..."
#         sudo apt-get update -y # Update package lists
#         sudo apt-get install -y libnss3-tools

#         echo "Adding mitmproxy CA certificate to user NSS database ($USER_NSSDB_PATH)..."
#         # The name "mitmproxy_cert" is an alias for the certificate in the database.
#         # The flags "CT,c,c" set the trust levels for SSL (C), Email (T), and Code Signing (c).
#         # CT = Trusted CA, c = valid CA, c = TCom
#         certutil -d sql:"$USER_NSSDB_PATH" -A -t "CT,c,c" -n "mitmproxy_cert" -i "$MITMPROXY_CA_CERT_SYSTEM_PATH"
#         echo "mitmproxy CA certificate added to NSS database."
#     else
#         echo "WARNING: NSS database directory ($USER_NSSDB_PATH) not found. Certificate import for browsers directly used by Puppeteer (if NSSDB is used) skipped."
#         echo "Note: The custom Firefox (Module 05) uses its own profile management."
#         echo "System-wide certificate integration (Module 04) and OpenWPM Firefox configuration (Module 07) are separate from this."
#     fi
# else
#     echo "WARNING: mitmproxy CA certificate ($MITMPROXY_CA_CERT_SYSTEM_PATH) not found. Certificate import skipped."
# fi

echo "Module 06: Puppeteer core installation complete." 