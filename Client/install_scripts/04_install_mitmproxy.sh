#!/bin/bash

# Module 4: Install mitmproxy

# Exit the script if any command fails
set -e

echo "Module 4: Starting mitmproxy installation..."

# Check if pip3 is available
if ! command -v pip3 &> /dev/null
then
    echo "pip3 could not be found. Please ensure Python3 and pip3 are installed (Module 1)."
    exit 1
fi

# Install mitmproxy using pip
echo "Installing mitmproxy via pip3..."
sudo pip3 install mitmproxy 

# Start mitmproxy for CA certificate generation
# mitmdump is started in the background to generate the CA certificate.
echo "Starting mitmdump temporarily to generate the CA certificate..."
mitmdump & # Starts in the background
MITMPROXY_PID=$!

echo "Waiting 5 seconds for mitmproxy to generate the CA certificate..."
sleep 5

# Check if the process is still running before attempting to kill it
if ps -p $MITMPROXY_PID > /dev/null
then
   echo "Stopping mitmdump (PID: $MITMPROXY_PID)..."
   kill $MITMPROXY_PID
   # Wait to ensure the process has terminated
   sleep 2
   # If it's still running, send SIGKILL
   if ps -p $MITMPROXY_PID > /dev/null; then
       echo "mitmdump process could not be terminated gracefully. Sending SIGKILL..."
       kill -9 $MITMPROXY_PID
   fi
else
   echo "mitmdump seems to have already terminated or was not started correctly."
fi


# Install specific version of mitmproxy if pip3 package is outdated 
if false; then

    # Define the download URL
    DOWNLOAD_URL="https://downloads.mitmproxy.org/10.3.1/mitmproxy-10.3.1-linux-x86_64.tar.gz"

    # Create a directory for the download
    mkdir -p ~/mitmproxy_install
    cd ~/mitmproxy_install

    # Download the latest version tarball
    curl -L $DOWNLOAD_URL -o mitmproxy.tar.gz

    # Extract the tarball
    tar -xzf mitmproxy.tar.gz

    # Verify the existence of binaries before moving them
    if [[ -f "mitmproxy" && -f "mitmdump" && -f "mitmweb" ]]; then
        sudo mv mitmproxy /usr/local/bin/
        sudo mv mitmdump /usr/local/bin/
        sudo mv mitmweb /usr/local/bin/
    else
        echo "Failed to find extracted binaries. Exiting."
        exit 1
    fi

    # Clean up
    cd ~
    rm -rf ~/mitmproxy_install

    # Verify installation
    echo "Installation completed. mitmproxy version:"
    mitmproxy --version

fi


MITMPROXY_CA_CERT_USER_PATH="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
SYSTEM_CA_DIR="/usr/local/share/ca-certificates"

if [ -f "$MITMPROXY_CA_CERT_USER_PATH" ]; then
  echo "Adding mitmproxy CA to the system trust store..."
  sudo install -m 0644 -D "$MITMPROXY_CA_CERT_USER_PATH" \
    "$SYSTEM_CA_DIR/mitmproxy-ca-cert.crt"   # <- .crt Endung!
  sudo update-ca-certificates
  # Kontrolle: sollte "1 added" o.ä. melden
  ls -l /etc/ssl/certs/*mitmproxy* || true
else
  echo "ERROR: mitmproxy CA ($MITMPROXY_CA_CERT_USER_PATH) not found."
fi

mitmproxy --version # For verification

echo "Module 4: mitmproxy installation complete." 