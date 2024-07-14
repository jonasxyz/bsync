#!/bin/bash

npm install

# Retrieve latest Tranco Top 100 list
curl -s https://tranco-list.eu/top-1m.csv.zip -o /tmp/top-1m.csv.zip && unzip -p /tmp/top-1m.csv.zip | head -n 100 > /home/user/Downloads/bsync/Server/tranco100.csv && rm /tmp/top-1m.csv.zip