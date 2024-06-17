#!/bin/bash

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
echo "Installing npm packages socket.io-client and puppeteer..."
sudo npm install -g socket.io-client puppeteer

# Install the latest Python version and pip
echo "Installing Python and pip..."
sudo apt-get install -y python3 python3-pip

# Install mitmproxy using pip
echo "Installing mitmproxy..."
pip3 install mitmproxy

# Clone and install OpenWPM from GitHub
echo "Cloning and installing OpenWPM..."
git clone https://github.com/mozilla/OpenWPM.git
cd OpenWPM
pip3 install -r requirements.txt
python3 setup.py install
cd ..

# Install and activate Conda
echo "Installing Miniconda..."
CONDA_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"
curl -o Miniconda3-latest-Linux-x86_64.sh $CONDA_URL
bash Miniconda3-latest-Linux-x86_64.sh -b -p $HOME/miniconda
eval "$($HOME/miniconda/bin/conda shell.bash hook)"
conda init

# Add mitmproxy CA certificate
echo "Adding mitmproxy CA certificate..."
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/
sudo update-ca-certificates

# Installation complete
echo "All installations are complete!"
