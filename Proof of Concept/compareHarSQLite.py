import os
import json
import csv
import sys
import sqlite3


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
    folder_name = os.path.basename(os.path.dirname(file_path))
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
    visited_urls = []
    for entry in har_data['log']['entries']:
        url = entry['request']['url']
        if url not in visited_urls:
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

    # Return the data as a list
    return [file_name, num_requests, num_responses, response_counts['1xx'], response_counts['2xx'], response_counts['3xx'], response_counts['4xx'], response_counts['5xx'], '\n'.join(visited_urls)]


# Define a function to parse the SQLite file and return the required data as a list
def process_sqlite_file(file_path):
    # Get the name of the folder containing the SQLite file
    folder_name = os.path.basename(os.path.dirname(file_path))
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

    # Initialize a dictionary to store the count of http responses
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
        if url not in visited_urls:
            visited_urls.append(url)

    # Return the data as a list
    return [file_name, num_requests, num_responses, response_counts['1xx'], response_counts['2xx'], response_counts['3xx'], response_counts['4xx'], response_counts['5xx'], '\n'.join(visited_urls)]



# Check if file1 is a .har file and process it
if file1_path.endswith('.har'):
    file1_data = process_har_file(file1_path)
    #file1_folder = file1_path.split('/')[-2]
# Check if file1 is a .sqlite file and process it
elif file1_path.endswith('.sqlite'):
    file1_data = process_sqlite_file(file1_path)
    #file1_folder = file1_path.split('/')[-1].split('.')[0]

# Get the data for each .har file
file2_data = process_sqlite_file(file2_path)

# Process the first file and get the visited URLs
file1_visited_urls = set(file1_data[-1].split('\n'))

# Process the second file and get the visited URLs
file2_visited_urls = set(file2_data[-1].split('\n'))

# Find additional URLs in the first file
#additional_urls_in_file1 = file1_visited_urls - file2_visited_urls

# Find additional URLs in the second file
#additional_urls_in_file2 = file2_visited_urls - file1_visited_urls


# Write the data to a CSV file
#csv_file_path = '/home/user/Schreibtisch/dump/scriptDump/output2.csv'
#with open(csv_file_path, 'w', newline='') as f:
    #writer = csv.writer(f)
    #writer.writerow(['Folder Name', 'Num Requests', 'Num Responses', '1xx', '2xx', '3xx', '4xx', '5xx', 'Visited URLs'])
   # writer.writerow(file1_data)
  #  writer.writerow(file2_data)
 #   writer.writerow(['Additional URLs in first file', additional_urls_in_file1])
#    writer.writerow(['Additional URLs in 2nd file', additional_urls_in_file2])


# Find additional URLs in the first file
additional_urls_in_file1 = '\n'.join(file1_visited_urls - file2_visited_urls)
num_additional_urls_in_file1 = len(additional_urls_in_file1)

# Find additional URLs in the second file
additional_urls_in_file2 = '\n'.join(file2_visited_urls - file1_visited_urls)
num_additional_urls_in_file2 = len(additional_urls_in_file2)



#csv_file_path = '/home/user/Schreibtisch/dump/scriptDump/output2.csv'
#with open(csv_file_path, 'w', newline='') as f:
#    writer = csv.writer(f)
#    writer.writerow(['Folder Name', 'Num Requests', 'Num Responses', '1xx', '2xx', '3xx', '4xx', '5xx', 'Visited URLs'])
#    writer.writerow(file1_data)
#    writer.writerow(file2_data)
#    writer.writerow(['Additional URLs in first file',0,0,0,0,0,0, len(additional_urls_in_file1)])
#    writer.writerows([['-']+[url] for url in additional_urls_in_file1])
#    writer.writerow(['Additional URLs in 2nd file', len(additional_urls_in_file2)])
#    writer.writerows([['-']+[url] for url in additional_urls_in_file2])

# Write the data to a CSV file
csv_file_path = '/home/user/Schreibtisch/dump/scriptDump/output2.csv'
with open(csv_file_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Folder Name', 'Num Requests', 'Num Responses', '1xx', '2xx', '3xx', '4xx', '5xx', 'Visited URLs'])
    writer.writerow(file1_data)
    writer.writerow(file2_data)
    writer.writerow(['Additional URLs in first file', num_additional_urls_in_file1, '', '', '', '', '', '', additional_urls_in_file1])
    writer.writerow(['Additional URLs in 2nd file', num_additional_urls_in_file2, '', '', '', '', '', '', additional_urls_in_file2])