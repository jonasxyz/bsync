#!/bin/bash

# Module 2: Install Node.js

# Exit the script if any command fails
set -e

echo "Module 2: Starting Node.js installation..."

check_node_version() {
    if command -v node &> /dev/null; then
        local node_version=$(node --version | cut -d. -f1 | cut -dv -f2)
        if (( node_version >= 18 )); then
            return 0 # True, Node.js 18+ is installed
        fi
    fi
    return 1 # False, Node.js 18+ is not installed or node not found
}

if [[ " $@ " =~ " --no-node " ]]; then
    echo "Module 2: Node.js installation skipped (Option --no-node detected)."
    exit 0
fi

# Check if Node.js 18 or newer is installed
if check_node_version; then
    echo "Node.js version 18 or newer is already installed."
    node --version
else
    echo "Node.js version 18 or newer is not installed. Starting installation..."

    # Install Node.js Version compatible to Ubuntu release
    ubuntu_version=$(lsb_release -rs)

    if [[ "$ubuntu_version" == "18.04" ]]; then
        echo "Ubuntu version is 18.04. Using specific installation path for Node.js 20."

        # Install build tools and other dependencies needed for Node.js compilation
        echo "Installing development tools (g++, make, gcc, bison)..."
        sudo apt-get update
        sudo apt-get install -y g++ make gcc bison

        cd "/home/$USER/Downloads/"
        
        echo "Installing 'n' (Node.js version manager)..."
        curl -L https://raw.githubusercontent.com/tj/n/master/bin/n -o n
        sudo bash n 20 # Install Node.js v20
        rm n # Clean up

        echo "Building and installing glibc 2.28 (required for newer Node.js versions on Ubuntu 18.04)..."
        sudo apt-get install -y gawk # Required for glibc build
        cd ~ # Go to home directory
        wget -c https://ftp.gnu.org/gnu/glibc/glibc-2.28.tar.gz
        tar -zxf glibc-2.28.tar.gz
        cd glibc-2.28
        mkdir -p glibc-build # -p to avoid error if it already exists
        cd glibc-build
        ../configure --prefix=/opt/glibc-2.28
        make -j$(nproc) # Use all available cores
        sudo make install
        cd ~ # Back to home directory
        rm -rf glibc-2.28 glibc-2.28.tar.gz # Clean up
        
        echo "Patching installed Node.js to use glibc 2.28..."
        sudo apt-get install -y patchelf 
        NODE_INSTALL_PATH=$(which node) # Find Node's path, typically /usr/local/bin/node
        if [ -z "$NODE_INSTALL_PATH" ]; then
            echo "ERROR: Node.js not found after installation with 'n'." 
            exit 1
        fi
        sudo patchelf --set-interpreter /opt/glibc-2.28/lib/ld-linux-x86-64.so.2 --set-rpath /opt/glibc-2.28/lib/:/lib/x86_64-linux-gnu/:/usr/lib/x86_64-linux-gnu/ "$NODE_INSTALL_PATH"

        echo "Updating npm to the latest version..."
        sudo "$NODE_INSTALL_PATH" "$(dirname "$NODE_INSTALL_PATH")/npm" install npm -g

    elif [[ "$(printf '%s\n' "$ubuntu_version" "18.04" | sort -V | head -n1)" == "18.04" ]]; then
        echo "Ubuntu version is newer than 18.04. Installing the latest Node.js LTS version via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "Ubuntu version is older than 18.04. This version is not currently supported by the script for automatic Node.js installation."
        exit 1
    fi
    echo "Node.js installation complete."
    node --version
    npm --version
fi

echo "Module 2: Node.js installation complete." 