import os
import json
import sqlite3
import glob
from pathlib import Path
import csv
import re

# Gemäß der test_config.js
STORAGE_PATH = os.path.expanduser("~/Downloads/bsync-test-data")
# Pfad zur URL-Liste, die für den Crawl verwendet wurde
URL_LIST_PATH = os.path.join(os.path.dirname(__file__), "test_url.txt")

def sanitize_url(url: str) -> str:
    """
    Replicates the URL sanitization logic from Client/functions/fileSystemUtils.js
    to create a string suitable for a directory name.
    Example: 'http://example.com/path' becomes 'example_com-path'.
    The JS logic is: str.replace(/\\//g, '-').replace(/[\\.:?&=]/g, '_')
    We also strip the protocol first, which seems to be the behavior.
    """
    if not isinstance(url, str):
        return ""
    
    # 1. Remove protocol
    sanitized = url.replace("https://", "").replace("http://", "")
    
    # 2. Replicate JS regex replacements
    # JS: str.replace(/\//g, '-') -> replaces all slashes with hyphens
    sanitized = sanitized.replace('/', '-')
    # JS: .replace(/[\.:?&=]/g, '_') -> replaces all specified characters with underscores
    sanitized = re.sub(r'[\.:?&=]', '_', sanitized)
    
    return sanitized

def find_latest_crawl_dir(storage_path):
    """Findet das neueste Crawl-Verzeichnis basierend auf dem Zeitstempel im Namen."""
    try:
        crawl_dirs = [d for d in os.listdir(storage_path) if os.path.isdir(os.path.join(storage_path, d)) and d.startswith('Crawl_')]
        if not crawl_dirs:
            return None
        # Sortiere absteigend und nimm das erste Element
        return os.path.join(storage_path, sorted(crawl_dirs, reverse=True)[0])
    except FileNotFoundError:
        return None

def load_url_list(file_path):
    """Lädt die URL-Liste aus einer Textdatei."""
    try:
        with open(file_path, 'r') as f:
            return [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        print(f"Fehler: URL-Liste {file_path} nicht gefunden.")
        return []

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

def get_urls_from_sqlite(conn, visit_id):
    """Extrahiert eine Liste aller Request-URLs für eine bestimmte visit_id."""
    urls = []
    try:
        cursor = conn.cursor()
        query_requests = "SELECT url FROM http_requests WHERE visit_id = ?"
        cursor.execute(query_requests, (visit_id,))
        
        rows = cursor.fetchall()
        urls = [row[0] for row in rows]
    except sqlite3.Error as e:
        print(f"  Fehler beim Lesen der http_requests für visit_id {visit_id}: {e}")
    return urls

def get_all_site_visits(sqlite_file):
    """Ruft alle Einträge aus der site_visits-Tabelle ab, sortiert nach visit_id."""
    visits = []
    try:
        conn = sqlite3.connect(sqlite_file)
        cursor = conn.cursor()
        cursor.execute("SELECT visit_id, site_url FROM site_visits ORDER BY visit_id ASC")
        visits = cursor.fetchall()
        return conn, visits
    except sqlite3.Error as e:
        print(f"Fehler beim Abrufen der site_visits: {e}")
        if conn:
            conn.close()
        return None, []

def analyze_visit(url_dir_path, dir_name, visit_id, site_url_from_db, conn):
    """Führt die Detailanalyse für ein einzelnes, zugeordnetes URL-Verzeichnis durch."""
    print(f"=================================================")
    print(f"Analyse für Verzeichnis: '{dir_name}' <-> DB (Visit ID: {visit_id}, URL: {site_url_from_db})")
    print(f"=================================================")
    
    har_files = list(Path(url_dir_path).glob('*.har'))

    if not har_files:
        # Bei Kalibrierungsläufen ist das Fehlen von HARs erwartet
        if 'calibration' in dir_name.lower():
            print("  -> Keine .har-Datei gefunden (erwartet für Kalibrierung).\n")
        else:
            print("  -> Keine .har-Datei in diesem Verzeichnis gefunden.\n")
        return

    har_file = har_files[0]
    har_urls = get_urls_from_har(har_file)
    sqlite_urls = get_urls_from_sqlite(conn, visit_id)

    # Interne Kalibrierungs-URLs aus dem Vergleich entfernen
    sqlite_urls = [u for u in sqlite_urls if '127.0.0.1' not in u]

    har_set = set(har_urls)
    sqlite_set = set(sqlite_urls)

    print(f"\n  --- ZUSAMMENFASSUNG für {dir_name} ---")
    print(f"  Anzahl Requests in .har (mitmproxy): {len(har_set)}")
    print(f"  Anzahl Requests in DB (OpenWPM):    {len(sqlite_set)}")

    if har_set == sqlite_set:
        print("\n  \033[92mErgebnis: ERFOLGREICH - Die URLs stimmen überein.\033[0m\n")
    else:
        print(f"\n  \033[91mErgebnis: FEHLGESCHLAGEN - URLs stimmen nicht überein.\033[0m")
        
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

def main():
    """Hauptfunktion zur Durchführung des Vergleichs pro besuchter URL."""
    print("Starte HAR- und OpenWPM-Datenbank-Vergleich...")

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

    # Finde alle individuellen URL-Verzeichnisse und sortiere sie numerisch
    urls_base_path = os.path.join(latest_crawl_dir, 'urls')
    if not os.path.exists(urls_base_path):
        print(f"Fehler: 'urls'-Verzeichnis nicht in {latest_crawl_dir} gefunden.")
        return

    try:
        all_url_dirs = sorted(
            [d for d in os.listdir(urls_base_path) if os.path.isdir(os.path.join(urls_base_path, d))],
            key=lambda d: int(d.split('_', 1)[0])
        )
    except (ValueError, IndexError):
        print("Fehler: Konnte URL-Verzeichnisse nicht numerisch sortieren. Stelle sicher, dass sie mit 'index_' beginnen.")
        return

    if not all_url_dirs:
        print("Keine URL-Verzeichnisse zum Analysieren gefunden.")
        return

    # Lade die zugehörigen Daten für den Abgleich
    conn, all_site_visits = get_all_site_visits(sqlite_file)
    if not conn:
        return

    # Trenne Kalibrierungs- und reguläre Läufe für eine robustere Zuordnung
    calibration_dirs = [d for d in all_url_dirs if 'calibration' in d.lower()]
    regular_dirs = [d for d in all_url_dirs if 'calibration' not in d.lower()]
    
    calibration_visits = [v for v in all_site_visits if '127.0.0.1' in v[1]]
    regular_visits = [v for v in all_site_visits if '127.0.0.1' not in v[1]]
    
    unmatched_dirs = set(regular_dirs)
    unmatched_visits = {v[1] for v in regular_visits}

    # 1. Zuordnung und Analyse der regulären URLs
    visit_map = {sanitize_url(visit[1]): visit for visit in regular_visits}
    
    for dir_name in regular_dirs:
        try:
            # Extrahiere den bereinigten URL-Teil aus dem Verzeichnisnamen (z.B. '1_example_com' -> 'example_com')
            sanitized_dir_url = dir_name.split('_', 1)[1]
        except IndexError:
            print(f"WARNUNG: Verzeichnis '{dir_name}' hat nicht das erwartete Format 'index_url' und wird ignoriert.")
            continue

        # Suche den passenden Datenbank-Eintrag über die bereinigte URL
        matched_visit = visit_map.get(sanitized_dir_url)
        if matched_visit:
            visit_id, site_url = matched_visit[:2]
            url_dir_path = os.path.join(urls_base_path, dir_name)
            
            analyze_visit(url_dir_path, dir_name, visit_id, site_url, conn)
            
            unmatched_dirs.discard(dir_name)
            unmatched_visits.discard(site_url)

    # 2. Zuordnung und Analyse der Kalibrierungsläufe (Annahme: Reihenfolge stimmt überein)
    for dir_name, visit in zip(calibration_dirs, calibration_visits):
        visit_id, site_url = visit[:2]
        url_dir_path = os.path.join(urls_base_path, dir_name)
        analyze_visit(url_dir_path, dir_name, visit_id, site_url, conn)

    # 3. Melde alle nicht zugeordneten Elemente
    if unmatched_dirs:
        print("=================================================")
        print(f"WARNUNG: Folgende {len(unmatched_dirs)} Verzeichnisse konnten keinem DB-Eintrag zugeordnet werden:")
        for dir_name in sorted(list(unmatched_dirs)):
            try:
                sanitized_part = dir_name.split('_', 1)[1]
                print(f"  - '{dir_name}' (erwarteter sanitierter Name: '{sanitized_part}')")
            except IndexError:
                print(f"  - '{dir_name}'")
        print("=================================================")

    if unmatched_visits:
        print("=================================================")
        print(f"WARNUNG: Folgende {len(unmatched_visits)} DB-Einträge konnten keinem Verzeichnis zugeordnet werden:")
        for site_url in sorted(list(unmatched_visits)):
             sanitized_part = sanitize_url(site_url)
             print(f"  - '{site_url}' (ergab sanitierter Name: '{sanitized_part}')")
        print("=================================================")
    
    if conn:
        conn.close()


if __name__ == "__main__":
    main()
