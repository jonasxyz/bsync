#!/bin/bash
# Dependencies: pyshark
# pip3 install pyshark

# usage: ./home/$USER/Downloads/bsync/Proof\ of\ Concept/proxyVsOpenWPM.sh

# 120 extra requests an mozilla server

# preferences: about:config


# Determine the script's directory
WORKING_DIR="$(dirname "$(readlink -f "$0")")"
echo "Working directory is: $WORKING_DIR"

OPENWPM_DIR=/home/$USER/Downloads/OpenWPM/
cd "$OPENWPM_DIR"


URL="http://example.com"
CLEAR_URL=$(echo "$URL" | sed 's/http:\/\//http__/')


DIR="/home/$USER/Downloads/PoC/"
LOG_DIR="${DIR}/${CLEAR_URL}"

mkdir -p "$LOG_DIR"

# Spawn fourth terminal and start mitmproxy
#gnome-terminal -- mitmdump --listen-host=127.0.0.1 --listen-port=3031 --set=hardump="$LOG_DIR/1.har" &
#PROXY_PID=$!

gnome-terminal -- bash -c "mitmdump --listen-host=127.0.0.1 --listen-port=3031 --set hardump='$LOG_DIR/mitmproxy_savehar.har'" &
PROXY_PID=$!
sleep 3

echo "Proxy PID: ${PROXY_PID}"
sleep 3

PIPE="/tmp/openwpm_pipe"
if [[ ! -p $PIPE ]]; then
    mkfifo $PIPE
fi

eval "$(conda shell.bash hook)"
conda activate openwpm
echo "conda done"
sleep 1
python openwpm_synced.py --proxyhost 127.0.0.1 --proxyport 3031 --crawldatapath "$LOG_DIR/OpenWPM_data" --url "$URL" < $PIPE &
PYTHON_PID=$! #  FUNKTIONIERT 
sleep 5
echo 'waited5'
# Wait for 'browserready' signal from the Python script
#while read -r line; do
 #   if [ "$line" == "browserready" ]; then
  #      break
   # fi
#done < $PIPE


# write visiturl to the terminal
echo 'next visiturl'
echo 'visiturl' > $PIPE

# Wait for the Python script to finish
wait $PYTHON_PID

# Killing the subprocess doesnt work atm, need manually close the terminal
echo 'Close proxy terminal to continue'
#kill $PROXY_PID
# Prompt user to manually close the proxy
read -p "Please close the proxy terminal and press [Enter] to continue..."



# Remove the named pipe
rm $PIPE
rm -f /tmp/mitmdump_pid

#'$LOG_DIR/mitmproxy_savehar.har'


echo "Working directory is: $WORKING_DIR"
cd "$WORKING_DIR"


python compareHarSQLite3.py "$LOG_DIR/mitmproxy_savehar.har" "$LOG_DIR/OpenWPM_data/crawl-data.sqlite"
