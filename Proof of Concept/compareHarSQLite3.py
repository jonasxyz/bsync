import os
import json
import csv
import sys
import sqlite3

import pyshark # if analyzing .pcapng

dir_path = f"/home/{os.environ.get('USER')}/Downloads/PoC/"

csv_file_path = f"/home/{os.environ.get('USER')}/Downloads/PoC/outputSet.csv"
# usage
# python compareHarSQLite3.py /home/user/Schreibtisch/dump/scriptDump/202304051746.har /home/user/Schreibtisch/OpenWPM/datadir/crawl-data.sqlite

# mitmdump:
# mitmdump --listen-host=127.0.0.1 --listen-port=3031 -s /home/user/Schreibtisch/dump/script/har_dump.py --set=hardump=/home/user/Schreibtisch/dump/scriptDump/$(date -d "today" +"%Y%m%d%H%M").har

# mitmdump save no body in .har
# mitmdump --listen-host=127.0.0.1 --listen-port=3031 -s /home/user/Schreibtisch/bsync/Client/functions/har_dump-no_body.py --set=hardump=/home/user/Schreibtisch/dump/scriptDump/mitmproxy_tranco100_$(date -d "today" +"%Y%m%d%H%M").har


# ignorehosts scheint nicht zu funtkionieren
# mitmdump --listen-host=127.0.0.1 --listen-port=3031 -s /home/user/Schreibtisch/dump/script/har_dump.py --set=hardump=/home/user/Schreibtisch/dump/scriptDump/$(date -d "today" +"%Y%m%d%H%M").har
# --ignore-hosts '^firefox\.settings\.services\.mozilla\.com:443$' --ignore-hosts '^content-signature-2\.cdn\.mozilla\.net:443$'

# Check if the correct number of arguments are provided
if len(sys.argv) != 3:
    print('Enter required files')
    sys.exit()

# Get the file paths from the command line arguments
file1_path = sys.argv[1]
file2_path = sys.argv[2]

# Define a function to parse the .har file and return the required data as a list
def process_har_file(file_path):
    # Get the name of the folder containing the .har file
    file_name = os.path.basename(file_path)

    # Load the .har file
    with open(file_path, 'r') as f:
        har_data = json.load(f)

    # Get the number of http requests
    num_requests = len(har_data['log']['entries'])

    # Get the number of http responses
    num_responses = len([entry for entry in har_data['log']['entries'] if 'response' in entry])

    # Initialize a dictionary to store the count of http responses
    response_counts = {
        '1xx': 0, # Informational responses (code 100 – 199)
        '2xx': 0, # Successful responses (200 – 299)
        '3xx': 0, # Redirection messages (300 – 399)
        '4xx': 0, # Client error responses (400 – 499)
        '5xx': 0, # Server error responses (500 – 599)
    }

    # Get the visited URLs
    #visited_urls = set()
    #for entry in har_data['log']['entries']:
    #    url = entry['request']['url']
    #    visited_urls.add(url)

    # Get the visited URLs
    visited_urls = []
    for entry in har_data['log']['entries']:
        url = entry['request']['url']
        #if url not in visited_urls:
        visited_urls.append(url)


        # Count the http response code
        response_code = entry['response']['status']
        if response_code >= 100 and response_code < 200:
            response_counts['1xx'] += 1
        elif response_code >= 200 and response_code < 300:
            response_counts['2xx'] += 1
        elif response_code >= 300 and response_code < 400:
            response_counts['3xx'] += 1
        elif response_code >= 400 and response_code < 500:
            response_counts['4xx'] += 1
        elif response_code >= 500 and response_code < 600:
            response_counts['5xx'] += 1

    print(file_name, ' URLs: ', len(visited_urls), 'unique URLs:', len(set(visited_urls)))

    # Return the data as a list
    return [file_name, num_requests, num_responses, response_counts['1xx'], response_counts['2xx'], response_counts['3xx'], response_counts['4xx'], response_counts['5xx'], visited_urls]

def process_sqlite_file(file_path):

    file_name = os.path.basename(file_path)

    # Connect to the SQLite database
    conn = sqlite3.connect(file_path)
    c = conn.cursor()

    # Get the number of http requests
    c.execute('SELECT COUNT(*) FROM http_requests')
    num_requests = c.fetchone()[0]

    # Get the number of http responses and redirects
    c.execute('SELECT (SELECT COUNT(*) FROM http_responses) + (SELECT COUNT(*) FROM http_redirects)')
    num_responses = c.fetchone()[0]

    # Dictionary to categorize the http responses
    response_counts = {
        '1xx': 0, # Informational responses (code 100 – 199)
        '2xx': 0, # Successful responses (200 – 299)
        '3xx': 0, # Redirection messages (300 – 399)
        '4xx': 0, # Client error responses (400 – 499)
        '5xx': 0, # Server error responses (500 – 599)
    }

    # Get the visited URLs
    visited_urls = []
    c.execute('SELECT response_status FROM http_responses UNION ALL SELECT response_status FROM http_redirects')
    for row in c.fetchall():
        response_code = int(row[0])
        if response_code >= 100 and response_code < 200:
            response_counts['1xx'] += 1
        elif response_code >= 200 and response_code < 300:
            response_counts['2xx'] += 1
        elif response_code >= 300 and response_code < 400:
            response_counts['3xx'] += 1
        elif response_code >= 400 and response_code < 500:
            response_counts['4xx'] += 1
        elif response_code >= 500 and response_code < 600:
            response_counts['5xx'] += 1


    c.execute('SELECT url FROM http_requests')
    for row in c.fetchall():
        url = row[0]
        #if url not in visited_urls:
        visited_urls.append(url)

    #c.execute('SELECT new_request_url FROM http_redirects')
    #for row in c.fetchall():
    #    url = row[0]
    #    if url not in visited_urls:
    #        visited_urls.append(url)

    print(file_name, 'URLs: ', len(visited_urls), 'unique URLs:', len(set(visited_urls)))

    # Return the data as a list
    return [file_name, num_requests, num_responses, response_counts['1xx'], response_counts['2xx'], response_counts['3xx'], response_counts['4xx'], response_counts['5xx'], visited_urls]


def process_pcapng_file(file_path):

    file_name = os.path.basename(file_path)

    # Open the pcapng file
    cap = pyshark.FileCapture(file_path, use_json=True, include_raw=True)

    # Initialize counters
    num_requests = 0
    num_responses = 0
    response_counts = {
        '1xx': 0, # Informational responses (code 100 – 199)
        '2xx': 0, # Successful responses (200 – 299)
        '3xx': 0, # Redirection messages (300 – 399)
        '4xx': 0, # Client error responses (400 – 499)
        '5xx': 0, # Server error responses (500 – 599)
    }

    visited_urls = []

    # Iterate through packets
    for pkt in cap:
        try:
            if 'http' in pkt and 'request' in pkt.http.field_names:
                num_requests += 1

                # Extract the visited URL
                host = pkt.http.host
                uri = pkt.http.request_uri
                url = f"http://{host}{uri}"
                visited_urls.append(url)

            if 'http' in pkt and 'response' in pkt.http.field_names:
                num_responses += 1

                # Count the http response code
                response_code = int(pkt.http.response_code)
                if response_code >= 100 and response_code < 200:
                    response_counts['1xx'] += 1
                elif response_code >= 200 and response_code < 300:
                    response_counts['2xx'] += 1
                elif response_code >= 300 and response_code < 400:
                    response_counts['3xx'] += 1
                elif response_code >= 400 and response_code < 500:
                    response_counts['4xx'] += 1
                elif response_code >= 500 and response_code < 600:
                    response_counts['5xx'] += 1
        except AttributeError:
            # Skip packets with incomplete data
            pass

    print(file_name, 'URLs: ', len(visited_urls))

    # Return the data as a list
    return [file_name, num_requests, num_responses, response_counts['1xx'], response_counts['2xx'], response_counts['3xx'], response_counts['4xx'], response_counts['5xx'], visited_urls]



# Check if file1 is a .har .sqlite or .pcapng file and process it
if file1_path.endswith('.har'):
    file1_data = process_har_file(file1_path)
elif file1_path.endswith('.sqlite'):
    file1_data = process_sqlite_file(file1_path)
elif file1_path.endswith('.pcapng'):
    file1_data = process_pcapng_file(file1_path)

# Get the data for each .har file
file2_data = process_sqlite_file(file2_path)

# Process the first file and get the visited URLs
file1_visited_urls = file1_data[-1] # set not possible because only unique elements

# Process the second file and get the visited URLs
file2_visited_urls = file2_data[-1]


# Custom function to count additional URLs in file1
def get_additional_urls(file1_visited_urls, file2_visited_urls):
    additional_urls = []
    file2_visited_urls_copy = file2_visited_urls.copy()  # Create a copy to avoid modifying the original list
    for url in file1_visited_urls:
        if url in file2_visited_urls_copy:
            file2_visited_urls_copy.remove(url)  # Remove the URL from the copy
        else:
            additional_urls.append(url)  # Add the URL to the additional_urls list
    return additional_urls

# Find additional URLs in the first file
new_additional_urls_in_file1 = get_additional_urls(file1_visited_urls, file2_visited_urls)
new_num_additional_urls_in_file1 = len(new_additional_urls_in_file1)
print('file1 additional URLs new method: ', new_num_additional_urls_in_file1)

# Find additional URLs in the second file
new_additional_urls_in_file2 = get_additional_urls(file2_visited_urls, file1_visited_urls)
new_num_additional_urls_in_file2 = len(new_additional_urls_in_file2)
print('file2 additional URLs new method: ', new_num_additional_urls_in_file2)


# Deprecated because additional URLs can be duplicates and sets dont allow duplicates
# Find additional URLs in the first file
additional_urls_in_file1 = set(file1_visited_urls) - set(file2_visited_urls)  # Convert lists to sets for this operation
#additional_urls_in_file1 = (file1_visited_urls - file2_visited_urls)
num_additional_urls_in_file1 = len(additional_urls_in_file1)

# Find additional URLs in the second file
additional_urls_in_file2 = set(file2_visited_urls) - set(file1_visited_urls)  # Convert lists to sets for this operation
#additional_urls_in_file2 = (file2_visited_urls - file1_visited_urls)
num_additional_urls_in_file2 = len(additional_urls_in_file2)

print('Additional URLs in file1:', num_additional_urls_in_file1)
print('Additional URLs in file2:', num_additional_urls_in_file2)

# Write the additional_urls_in_file1 to a text file
with open(f"{dir_path}/additional_urls_in_file1.txt", 'w') as f:
    for url in additional_urls_in_file1:
        f.write(f"{url}\n")

# Write the additional_urls_in_file2 to a text file
with open(f"{dir_path}/additional_urls_in_file2.txt", 'w') as f:
    for url in additional_urls_in_file2:
        f.write(f"{url}\n")


# Write the data to a CSV file

with open(csv_file_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Folder Name', 'Num Requests', 'Num Responses', '1xx', '2xx', '3xx', '4xx', '5xx', 'Visited URLs'])
    writer.writerow(file1_data)
    writer.writerow(file2_data)
    writer.writerow(['Additional URLs in first file', new_num_additional_urls_in_file1, '', '', '', '', '', '', '\n'.join(new_additional_urls_in_file1)])
    writer.writerow(['Additional URLs in 2nd file', new_num_additional_urls_in_file2, '', '', '', '', '', '', '\n'.join(new_additional_urls_in_file2)])

# die allermeisten der in sqlite additional urls sind auch in der proxy .har, scheinen nur in der sqlite doppelt zu sein

# SELECT * FROM 'http_requests' WHERE url LIKE '%https://abs.twimg.com/responsive-web/client-web-legacy/shared~loader.Typeahead~bundle.LoggedOutHome~bundle.Search.9fe4261a.js%'

# ergibt zwei ergebnisse, die unterscheiden sich vorallem im feld resource_type, das erste ist script, das andere xmlhttprequest.


 # SELECT * FROM 'http_requests'WHERE url LIKE '%https://www.microsoft.com/etc.clientlibs/microsoft/components/content/highlight/v1/highlight/clientlibs/site.min.ACSHASH03a75d73237712c7c2e3e3b6d6037230.js%'

 # hier sogar 4 mal das gleiche script als request. proxy nimmt laut timestamp nur das erste mit

# zugehörige response checken

# preferences bearbeiten
# browser.cache.disk.enable ausstellen
# browser.cache.memory.enable ausstellen

 ## Ignore host and forward all traffic without processing it. In
# transparent mode, it is recommended to use an IP address (range), not
# the hostname. In regular mode, only SSL traffic is ignored and the
# hostname should be used. The supplied value is interpreted as a
# regular expression and matched on the ip or the hostname. Type
# sequence of str.
#ignore_hosts: []
