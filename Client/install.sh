#!/bin/bash


# This script automates the installation of bsync-client
# requirements and automation framework setup

# Requirements: git, curl, nodejs, npm: socket.io-client and puppeteer,
# python3, python3-pip, mitmproxy, OpenWPM, p11-kit

# Arguments:
# --no-puppeteer: Doesn't install and configure OpenWPM
# --no-openwpm: Doesn't install puppeteer

# Exit the script if any command fails
set -e

# Update and upgrade the system
echo "Updating and upgrading the system..."
sudo apt-get update -y && sudo apt-get upgrade -y

# Install Git
echo "Installing Git..."
sudo apt-get install -y git

# Install cURL
echo "Installing cURL..."
sudo apt-get install -y curl

# Install the latest LTS version of Node.js
echo "Installing Node.js LTS version..."
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install npm packages
echo "Installing npm package socket.io-client..."
sudo npm install -g socket.io-client puppeteer
echo "Installing npm package puppeteer..."
if [ "$1" != "--no-puppeteer" ]; then
	sudo npm install -g puppeteer
fi

# Install the latest Python version and pip
echo "Installing Python and pip..."
sudo apt-get install -y python3 python3-pip

# Install mitmproxy using pip
echo "Installing mitmproxy..."
pip3 install mitmproxy --break-system-packages # allow system-wide installation

# Start mitmproxy for CA certificate generation
echo "Starting mitmproxy"
mitmdump &
MITMPROXY_PID=$!
sleep 4
echo "Stopping mitmproxy"
kill $MITMPROXY_PID

# Add mitmproxy CA certificate
echo "Adding mitmproxy CA certificate..."
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/
sudo update-ca-certificates

if [ "$1" != "--no-openwpm" ]; then
	# Install and activate Mamba as Conda replacement
	echo "Installing Mamba..."
	curl -L -O "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-$(uname)-$(uname -m).sh"
	bash Miniforge3-$(uname)-$(uname -m).sh

	echo "Restarting Shell..."
	source ~/.bashrc

	echo "Cloning and installing OpenWPM..."
	cd /home/$USER/Desktop/
	git clone https://github.com/mozilla/OpenWPM.git
	cd OpenWPM
	micromamba activate /home/§USER/miniforge3
	./install.sh
	cd ..

	# Replace OpenWPMs libnssckbi.so with p11-kit's file so Firefox
	# reads cerifcates from system certificate store
	echo "Setting up OpenWPM's Firefox for proxy use"
	# Todo nur noch prüfen ob die p11 Datei bei stock Ubuntu drauf ist
	sudo mv /home/$USER/Desktop/OpenWPM/firefox-bin/libnssckbi.so /home/$USER/Desktop/OpenWPM/firefox-bin/libnssckbi.so.bak
	sudo ln -s /usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-trust.so /home/$USER/Desktop/OpenWPM/firefox-bin/libnssckbi.so
	
fi

echo "All installations are complete!"
