#!/bin/bash

# Configure Firefox to automatically generate .har file for each Website visited
#   1. set Firefox preference 'devtools.netmonitor.har.enableAutoExportToFile' to true about:config
# browser.cache preference deaktiviren
#   2. set Firefox proxy to specified mitmproxy ip+port
#   2. Firefox must be opened with opened DevTools
#   3. Locate generated .har file in profiles root folder -> /har/logs

# devtools.netmonitor.persistlog Für websiteübergreifende speicherung

#url="example.com"
url="google.com"
dump_path="/home/user/Schreibtisch/dump/scriptDump/"


# Spawn terminal to launch mitmproxy instance
gnome-terminal -- mitmdump --listen-host=127.0.0.1 --listen-port=3031 -s /home/user/Schreibtisch/dump/script/har_dump.py --set=hardump=/home/user/Schreibtisch/dump/scriptDump/mitmproxy.har

#gnome-terminal -- -c "mitmdump --listen-host=127.0.0.1 --listen-port=3031 -s /home/user/Schreibtisch/dump/script/har_dump.py --set=hardump=/home/user/Schreibtisch/dump/testDump/mitmproxy1.har; exec bash"

# launch with timestamp as filename
#$(date -d "today" +"%Y%m%d%H%M")
 mitmdump --listen-host=127.0.0.1 --listen-port=3031 -s /home/user/Schreibtisch/dump/script/har_dump.py --set=hardump=/home/user/Schreibtisch/dump/scriptDump/$(date -d "today" +"%Y%m%d%H%M").har
sleep 2

#  Spawn Firefox instance with opened DevTools
 #gnome-terminal -- sh -c "echo 'Spawning Firefox DevTools instance'; firefox -devtools $url; exec bash"

 gnome-terminal -- sh -c "echo 'Spawning Firefox DevTools instance'; firefox $url -jsdebugger -devtools; exec bash"

# Spawn OpenWPM Firefox
#gnome-terminal -- sh -c "echo 'Spawning Firefox DevTools instance'; /home/user/Schreibtisch/OpenWPM/firefox-bin/firefox $url -jsdebugger -devtools ; exec bash"
 

#/home/user/.cache/mozilla/firefox/wn9kfr2s.default-release