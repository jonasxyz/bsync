#!/bin/bash


# This script automates the installation of bsync-client
# requirements and automation framework setup

# Following components will be installed: curl, nodejs, npm: socket.io-client and puppeteer,
# python3, python3-pip, mitmproxy, OpenWPM, p11-kit, g++, make, gcc bison, patchelf, gawk

# Arguments:
# --no-puppeteer: Doesn't install and configure OpenWPM
# --no-openwpm: Doesn't install puppeteer
# --no-node: Doesn't install NodeJS

# Exit the script if any command fails
set -e

SCRIPT_DIR="$(dirname "$(realpath "$0")")"

# Update and upgrade the system
echo "Updating and upgrading the system..."
sudo apt-get update -y && sudo apt-get upgrade -y

# Install cURL
echo "Installing cURL..."
sudo apt-get install -y curl

check_node_version() {
    if command -v node &> /dev/null; then
        local node_version=$(node --version | cut -d. -f1 | cut -dv -f2)
        if (( node_version >= 18 )); then
            return 0
        fi
    fi
    return 1
}

# Check if Node.js 18 or newer is installed
if check_node_version; then
    echo "Node.js version 18 or newer is already installed."
else
    echo "Node.js version 18 or newer is not installed. Installing now..."


	# Install Node.js Version compatible to Ubuntu release
	ubuntu_version=$(lsb_release -rs)

	if [[ "$ubuntu_version" == "18.04" ]]; then
		echo "Ubuntu version is 18.04. "
		#curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - # puppeteer requires Node>=18

		# Workaround installing NodeJS 20 on Ubuntu18.04
		# https://github.com/nodesource/distributions/issues/1392#issuecomment-1815887430
		cd /home/$USER/Downloads/
		sudo apt-get install -y g++ make gcc bison

		curl -L https://raw.githubusercontent.com/tj/n/master/bin/n -o n
		sudo bash n 20

		# Build and install glibc 2.28:
		sudo apt install -y gawk
		cd ~
		wget -c https://ftp.gnu.org/gnu/glibc/glibc-2.28.tar.gz
		tar -zxf glibc-2.28.tar.gz
		cd glibc-2.28
		pwd
		mkdir glibc-build
		cd glibc-build
		../configure --prefix=/opt/glibc-2.28
		make -j 4 # Use all 4 Jetson Nano cores for much faster building
		sudo make install
		cd ..
		rm -fr glibc-2.28 glibc-2.28.tar.gz
		
		# Patch the installed Node 20 to work with /opt/glibc-2.28 instead: 
		sudo apt install -y patchelf
		sudo patchelf --set-interpreter /opt/glibc-2.28/lib/ld-linux-x86-64.so.2 --set-rpath /opt/glibc-2.28/lib/:/lib/x86_64-linux-gnu/:/usr/lib/x86_64-linux-gnu/ /usr/local/bin/node

		# Todo check if npm update works
		sudo npm install npm -g


	elif [[ "$(printf '%s\n' "$ubuntu_version" "18.04" | sort -V | head -n1)" == "18.04" ]]; then

		echo "Ubuntu version is newer than 18.04. Installing Latest Node.js LTS release"
		curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
		sudo apt-get install -y nodejs
		
	else
		echo "Ubuntu version is older than 18.04"
	fi
fi
node --version


# Install and activate Mamba as Conda replacement
cd /home/$USER/Downloads
#echo "Installing Mamba..."
#curl -L -O "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-$(uname)-$(uname -m).sh"
#bash Miniforge3-$(uname)-$(uname -m).sh

echo "Installing Mamba... OpenWPMs way" # mambaforge instead of miniforge3
curl -L -O "https://github.com/conda-forge/miniforge/releases/latest/download/Mambaforge-$(uname)-$(uname -m).sh" #-O mamba.sh;
bash Mambaforge-$(uname)-$(uname -m).sh
#source "$HOME/mamba/etc/profile.d/conda.sh"

echo "Restarting Shell..."
source ~/.bashrc
eval "$(/home/$USER/mambaforge/bin/conda shell.bash hook)"
conda config --set auto_activate_base true
conda init

# Clean up downloaded mamba installer
rm Mambaforge-$(uname)-$(uname -m).sh

# Install latest Python version and pip
echo "Installing Python and pip..."
sudo apt-get install -y python3 python3-pip

# Install mitmproxy using pip
echo "Installing mitmproxy..."
sudo pip3 install mitmproxy # --break-system-packages # allow system-wide installation

pip install websockets # todo check if this installs in mamba env. Needs to be installed in normal python env.

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

echo "Installing npm package puppeteer..."
if [ "$1" != "--no-puppeteer" ]; then

	# SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"  TODO moved to front
	# SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" # some cases not working
	echo "Installing npm packages in directory $SCRIPT_DIR"
	cd "$SCRIPT_DIR/Client"  # todo currently only works after restarting script

	sudo npm install

	cd "$SCRIPT_DIR/puppeteer"

	# npx puppeteer browsers install chrome # Foxusing on Firefox
	echo "Installing Firefox for Puppeteer (version stable_138.0.1)..."
	npx @puppeteer/browsers install firefox@stable_138.0.1
	
	echo "Start puppeteer for generating CA cert destination "
	node puppeteer_synced.js &
	PUPPETEER_PID=$!
	sleep 4
	echo "Stopping puppeteer"
	kill $PUPPETEER_PID

	# Add mitmproxy SSL certificate into Chromium Trusted CA Storage
	sudo apt install libnss3-tools
	certutil -d sql:/home/$USER/.pki/nssdb -A -t "CT,c,c" -n "mitmproxy_cert" -i /usr/local/share/ca-certificates/mitmproxy-ca-cert.pem
	# https://superuser.com/a/1703365
fi

if [ "$1" != "--no-openwpm" ]; then

	echo "Cloning and installing OpenWPM..."
	cd /home/$USER/Desktop/
	git clone https://github.com/openwpm/OpenWPM.git
	# git clone https://github.com/openwpm/OpenWPM.git -- branch v0.28.0 # check v0.29.0 compatibility
	cd OpenWPM

	# Fixing occuring npm bug
	sudo chown -R 1000:1000 "/home/user/.npm" # occurs at least with npm 10.8.2 and npm 10.7.0


	eval "$(/home/$USER/mambaforge/bin/conda shell.bash hook)"

	# micromamba activate /home/§USER/miniforge3 #OpenWPM still utilizing mambaforge
	# micromamba activate /home/§USER/mambaforge # not working if not auto-initialized
	./install.sh
	cd ..

	# Replace OpenWPMs libnssckbi.so with p11-kit's file so Firefox
	# reads cerifcates from system certificate store
	echo "Setting up OpenWPM's Firefox for proxy use"
	# Todo nur noch prüfen ob die p11 Datei bei stock Ubuntu drauf ist
	sudo mv /home/$USER/Desktop/OpenWPM/firefox-bin/libnssckbi.so /home/$USER/Desktop/OpenWPM/firefox-bin/libnssckbi.so.bak
	sudo ln -s /usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-trust.so /home/$USER/Desktop/OpenWPM/firefox-bin/libnssckbi.so

	# Paste bsync's crawl script to OpenWPM folder

	# Determine the script's directory
	echo "Script directory is: $SCRIPT_DIR"
	cp $SCRIPT_DIR/OpenWPM/openwpm_synced.py /home/$USER/Desktop/OpenWPM/ # TODO Test
	
fi

# Install dev Tools for remote deployment
# sudo apt install openssh-server
# sudo apt-get install tmux

# sudo systemctl start ssh
# sudo systemctl enable ssh
# sudo nano /etc/ssh/sshd_config
# sudo ufw allow ssh
# sudo ufw enable
# sudo systemctl restart ssh


echo "All installations are complete!"
