#!/bin/bash

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

