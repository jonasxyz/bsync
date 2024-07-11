#!/bin/bash

# Create folder with timestamp name for sslkeylogfile
logdir=$(date +"%Y-%m-%d_%H-%M-%S")
mkdir $logdir

# Spawn first terminal and set sslkeylogfile to new folder, and launch Firefox
gnome-terminal -- sh -c "echo 'Setting enviroment Variable SSLKEYLOGFILE'; export SSLKEYLOGFILE=$logdir/SSLKEYLOGFILE.log; echo 'Variable SSLKEYLOGFILE set to '$logdir/SSLKEYLOGFILE.log ; firefox example.com; exec bash"

sleep 2

# Spawn second terminal and store Firefox PID in variable
#firefox_pid=$(gnome-terminal -- sh -c "pidof firefox; exec bash")
firefox_pid=$(ps -ef | grep firefox | head -n 1 | awk '{print $2}') 
##firefox_pid=$(ps -ef | grep firefox | awk '{print $2}' | sed -n '2p') ## hopefully get second pid

echo "Firefox PID: $firefox_pid"
#gnome-terminal -- sudo /home/user/Downloads/ecapture-v0.4.11-linux-x86_64/ecapture tls --pid=$firefox_pid -i enp1s0 --nspr /usr/lib/firefox/libnspr4.so -w $logdir/ecapture.pcapng --ssl_version openssl 1.1.1m --libssl /usr/lib/x86_64-linux-gnu/libssl.so.1.1
gnome-terminal -- sudo /home/user/Downloads/ecapture-v0.4.11-linux-x86_64/ecapture tls --pid=$firefox_pid -i enp1s0 --nspr /usr/lib/firefox/libnspr4.so -w $logdir/ecapture.pcapng

# Spawn third terminal and start tcpdump
# gnome-terminal -- sudo tcpdump 'tcp port http or tcp port https' -s0 -A -w $logdir/tcpdump.pcapng -v scheint weniger zu funktionieren
# gnome-terminal -- sudo tcpdump 'tcp port 80 or tcp port 443' -s0 -A -w $logdir/tcpdump.pcapng -v # für tests ohne proxy
 gnome-terminal -- sudo tcpdump 'tcp port 3031' -s0 -A -w $logdir/tcpdump.pcapng -v # anderer port weil proxy. funktioniert grad nicht

# Spawn fourth terminal and start mitmproxy
gnome-terminal -- mitmdump --listen-host=127.0.0.1 --listen-port=3031 -s /home/user/Schreibtisch/dump/script/har_dump.py --set=hardump=$logdir/mitmproxy.har

