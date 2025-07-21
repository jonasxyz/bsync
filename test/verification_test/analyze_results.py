import os
import json
import sqlite3
import glob
from pathlib import Path
import csv

# Gemäß der test_config.js
STORAGE_PATH = os.path.expanduser("~/Downloads/bsync-test-data")
# Pfad zur URL-Liste, die für den Crawl verwendet wurde
URL_LIST_PATH = os.path.join(os.path.dirname(__file__), "test_url.txt")

def find_latest_crawl_dir(storage_path):
    """Findet das neueste Crawl-Verzeichnis basierend auf dem Zeitstempel im Namen."""
    try:
        crawl_dirs = [d for d in os.listdir(storage_path) if os.path.isdir(os.path.join(storage_path, d)) and d.startswith('Crawl_')]
        if not crawl_dirs:
            return None
        return os.path.join(storage_path, sorted(crawl_dirs)[-1])
    except FileNotFoundError:
        return None

def load_url_list(file_path):
    """Lädt die URL-Liste und gibt sie als Dictionary {index: url} zurück."""
    urls = {}
    try:
        with open(file_path, 'r', newline='') as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) == 2:
                    try:
                        urls[int(row[0])] = row[1]
                    except ValueError:
                        print(f"Warnung: Ungültiger Index in Zeile: {row}")
    except FileNotFoundError:
        print(f"Fehler: URL-Liste nicht gefunden unter {file_path}")
    return urls

def get_urls_from_har(har_file):
    """Extrahiert eine Liste aller Request-URLs aus einer .har-Datei und filtert interne Proxy-Anfragen heraus."""
    urls = []
    try:
        with open(har_file, 'r', encoding='utf-8') as f:
            har_data = json.load(f)
            for entry in har_data.get('log', {}).get('entries', []):
                # Interne Proxy-Kommunikation ignorieren
                if ".proxy.local" not in entry['request']['url']:
                    urls.append(entry['request']['url'])
    except (json.JSONDecodeError, FileNotFoundError) as e:
        print(f"  Fehler beim Lesen der HAR-Datei {har_file}: {e}")
    return urls

def get_urls_from_sqlite(sqlite_file, site_url_filter):
    """Extrahiert eine Liste aller Request-URLs für eine bestimmte Top-Level-URL,
    indem die visit_id aus der site_visits-Tabelle verwendet wird."""
    urls = []
    if not site_url_filter:
        return urls

    # LIKE-Filter, um Variationen wie http/https und www zu behandeln
    domain_filter = f'%{site_url_filter}%'
    print(f"  [SQLite] Suche nach visit_id für site_url LIKE '{domain_filter}'")

    try:
        conn = sqlite3.connect(sqlite_file)
        cursor = conn.cursor()

        # Schritt 1: Finde die passende(n) visit_id(s) in der site_visits Tabelle
        query_visit_id = "SELECT visit_id FROM site_visits WHERE site_url LIKE ?"
        cursor.execute(query_visit_id, (domain_filter,))
        visit_id_rows = cursor.fetchall()

        if not visit_id_rows:
            print(f"  [SQLite] Warnung: Keine visit_id für '{site_url_filter}' in site_visits gefunden.")
            conn.close()
            return urls

        visit_ids = [row[0] for row in visit_id_rows]
        print(f"  [SQLite] Gefundene visit_id(s): {visit_ids}")

        # Schritt 2: Extrahiere alle http_requests für die gefundenen visit_id(s)
        # Die Verwendung von 'IN' stellt sicher, dass wir alle zugehörigen Requests abrufen,
        # falls eine URL im Testlauf mehrfach besucht wurde.
        placeholders = ','.join('?' for _ in visit_ids)
        query_requests = f"SELECT url FROM http_requests WHERE visit_id IN ({placeholders})"
        cursor.execute(query_requests, visit_ids)
        
        rows = cursor.fetchall()
        urls = [row[0] for row in rows]
        conn.close()
    except sqlite3.Error as e:
        print(f"  Fehler beim Lesen der SQLite-Datenbank {sqlite_file}: {e}")
    return urls

def main():
    """Hauptfunktion zur Durchführung des Vergleichs pro besuchter URL."""
    print("Starte HAR- und OpenWPM-Datenbank-Vergleich...")

    # Lade die "Ground Truth" URL-Liste
    url_map = load_url_list(URL_LIST_PATH)
    if not url_map:
        return
    print(f"URL-Liste geladen: {url_map}")

    latest_crawl_dir = find_latest_crawl_dir(STORAGE_PATH)
    if not latest_crawl_dir:
        print(f"Fehler: Kein Crawl-Verzeichnis in {STORAGE_PATH} gefunden.")
        return
    print(f"Analysiere neuesten Crawl: {latest_crawl_dir}\n")

    # Finde die zentrale SQLite-Datenbank
    sqlite_files = list(Path(latest_crawl_dir).rglob('crawl-data.sqlite'))
    if not sqlite_files:
        print("Fehler: Keine crawl-data.sqlite-Datei im Crawl-Verzeichnis gefunden.")
        return
    sqlite_file = sqlite_files[0]
    print(f"Gefundene SQLite-DB: {sqlite_file}\n")

    # Finde alle individuellen URL-Verzeichnisse
    urls_base_path = os.path.join(latest_crawl_dir, 'urls')
    if not os.path.exists(urls_base_path):
        print(f"Fehler: 'urls'-Verzeichnis nicht in {latest_crawl_dir} gefunden.")
        return

    url_dirs = sorted([d for d in os.listdir(urls_base_path) if os.path.isdir(os.path.join(urls_base_path, d))])
    if not url_dirs:
        print("Keine URL-Verzeichnisse zum Analysieren gefunden.")
        return

    # Führe die Analyse für jedes URL-Verzeichnis durch
    for url_dir_name in url_dirs:
        print(f"=================================================")
        print(f"Analyse für: {url_dir_name}")
        print(f"=================================================")

        url_dir_path = os.path.join(urls_base_path, url_dir_name)
        har_files = list(Path(url_dir_path).glob('*.har'))

        if not har_files:
            print("  -> Keine .har-Datei in diesem Verzeichnis gefunden.\n")
            continue

        har_file = har_files[0]
        print(f"  HAR-Datei: {os.path.basename(str(har_file))}")

        # Finde die Ground-Truth-URL für dieses Verzeichnis
        try:
            dir_index = int(url_dir_name.split('_', 1)[0])
            site_url_filter = url_map.get(dir_index)
            if not site_url_filter:
                print(f"  Warnung: Kein Eintrag für Index {dir_index} in der URL-Liste gefunden.")
                continue
        except (ValueError, IndexError):
            print(f"  Warnung: Konnte Index aus Verzeichnisnamen '{url_dir_name}' nicht extrahieren.")
            continue

        har_urls = get_urls_from_har(har_file)
        sqlite_urls = get_urls_from_sqlite(sqlite_file, site_url_filter)

        har_set = set(har_urls)
        sqlite_set = set(sqlite_urls)

        print(f"\n  --- ZUSAMMENFASSUNG für {url_dir_name} ({site_url_filter}) ---")
        print(f"  Anzahl Requests in .har (mitmproxy): {len(har_urls)}")
        print(f"  Anzahl Requests in DB (OpenWPM):    {len(sqlite_urls)}")

        if har_set == sqlite_set:
            print("\n  Ergebnis: \033[92mERFOLGREICH\033[0m - Die URLs stimmen überein.\n")
        else:
            print(f"\n  Ergebnis: \033[91mFEHLGESCHLAGEN\033[0m - URLs stimmen nicht überein.")

            only_in_har = har_set - sqlite_set
            only_in_sqlite = sqlite_set - har_set

            if only_in_har:
                print(f"\n  URLs NUR in .har (mitmproxy) erfasst ({len(only_in_har)}):")
                for url in sorted(list(only_in_har)):
                    print(f"    - {url}")

            if only_in_sqlite:
                print(f"\n  URLs NUR in OpenWPM DB erfasst ({len(only_in_sqlite)}):")
                for url in sorted(list(only_in_sqlite)):
                    print(f"    - {url}")
            print("\n")


if __name__ == "__main__":
        main()
