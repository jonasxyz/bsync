#!/bin/bash

# Check if the correct number of arguments was provided
if [ $# -ne 1 ]
then
    echo "Usage: $0 <location>"
    exit 1
fi

# Navigate to the specified directory
cd $1

# Decrypt the first .pcapng file using the SSLKEYLOGFILE.log and save as decrypted_file1.pcapng
tshark -r tcpdump.pcapng -o "ssl.keylog_file:SSLKEYLOGFILE.log" -o "ssl.desegment_ssl_records:TRUE" -o "ssl.desegment_ssl_application_data:TRUE" -w decrypted_file1.pcapng

# Extract HTTP request and response packet counts from the decrypted file
decrypted_file1_requests=$(tshark -r decrypted_file1.pcapng -Y "http.request.method" | wc -l)
decrypted_file1_responses=$(tshark -r decrypted_file1.pcapng -Y "http.response.code" | wc -l)

# Decrypt the second .pcapng file using the SSLKEYLOGFILE.log and save as decrypted_file2.pcapng
tshark -r ecapture.pcapng -o "ssl.keylog_file:SSLKEYLOGFILE.log" -o "ssl.desegment_ssl_records:TRUE" -o "ssl.desegment_ssl_application_data:TRUE" -w decrypted_file2.pcapng

# Extract HTTP request and response packet counts from the decrypted file
decrypted_file2_requests=$(tshark -r decrypted_file2.pcapng -Y "http.request.method" | wc -l)
decrypted_file2_responses=$(tshark -r decrypted_file2.pcapng -Y "http.response.code" | wc -l)

# Print out the results
echo "File 1 HTTP request packets: $(tshark -r tcpdump.pcapng -Y "http.request.method" | wc -l)"
echo "File 1 HTTP response packets: $(tshark -r tcpdump.pcapng -Y "http.response.code" | wc -l)"
echo "File 1 decrypted HTTP request packets: $decrypted_file1_requests"
echo "File 1 decrypted HTTP response packets: $decrypted_file1_responses"

echo "File 2 HTTP request packets: $(tshark -r ecapture.pcapng -Y "http.request.method" | wc -l)"
echo "File 2 HTTP response packets: $(tshark -r ecapture.pcapng -Y "http.response.code" | wc -l)"
echo "File 2 decrypted HTTP request packets: $decrypted_file2_requests"
echo "File 2 decrypted HTTP response packets: $decrypted_file2_responses"
