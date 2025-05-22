#!/bin/bash

# Module 1: Install system dependencies

# Exit the script if any command fails
set -e

echo "Module 1: Starting installation of system dependencies..."

# Update and upgrade the system
echo "Updating and upgrading the system..."
sudo apt-get update -y && sudo apt-get upgrade -y

# Install cURL
echo "Installing cURL..."
sudo apt-get install -y curl

# Install Python and pip
echo "Installing Python3 and pip3..."
sudo apt-get install -y python3 python3-pip

echo "Module 1: Installation of system dependencies complete." 