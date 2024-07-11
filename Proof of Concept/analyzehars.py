import os
import json
import csv

# Path to the folder containing the .har file
folder_path = '/home/user/Schreibtisch/dump/puppeteer/2023-02-24:10-13-45/youtube_com/'

# Get the name of the folder
folder_name = os.path.basename(folder_path)

# Path to the .har file
har_file_path = os.path.join(folder_path, 'youtube_com.har')

# Load the .har file
with open(har_file_path, 'r') as f:
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

# Write the data to a CSV file
csv_file_path = os.path.join(folder_path, 'output.csv')
with open(csv_file_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Folder Name', 'Num Requests', '1xx', '2xx', '3xx', '4xx', '5xx', 'Visited URLs'])
    writer.writerow([folder_name, num_requests, response_counts['1xx'], response_counts['2xx'], response_counts['3xx'], response_counts['4xx'], response_counts['5xx'], '\n'.join(visited_urls)])