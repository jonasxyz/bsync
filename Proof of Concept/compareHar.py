import os
import json
import csv
import sys

# Check if the correct number of arguments are provided
if len(sys.argv) != 3:
    print('Usage: python script.py path/to/file1.har path/to/file2.har')
    sys.exit()

# Get the file paths from the command line arguments
file1_path = sys.argv[1]
file2_path = sys.argv[2]

# Define a function to parse the .har file and return the required data as a list
def process_har_file(file_path):
    # Get the name of the folder containing the .har file
    folder_name = os.path.basename(os.path.dirname(file_path))

    # Load the .har file
    with open(file_path, 'r') as f:
        har_data = json.load(f)

    # Get the number of http requests
    num_requests = len(har_data['log']['entries'])

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
    return [folder_name, num_requests, response_counts['1xx'], response_counts['2xx'], response_counts['3xx'], response_counts['4xx'], response_counts['5xx'], '\n'.join(visited_urls)]

# Get the data for each .har file
file1_data = process_har_file(file1_path)
file2_data = process_har_file(file2_path)

# Write the data to a CSV file
csv_file_path = 'output.csv'
with open(csv_file_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Folder Name', 'Num Requests', '1xx', '2xx', '3xx', '4xx', '5xx', 'Visited URLs'])
    writer.writerow(file1_data)
    writer.writerow(file2_data)