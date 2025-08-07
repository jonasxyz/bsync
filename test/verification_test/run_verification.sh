#!/bin/bash
# run_verification.sh - Startet den Test-Server, Scheduler und Worker für den Verifikationstest.

# Den absoluten Pfad zum Projektverzeichnis ermitteln
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
PROJECT_DIR=$(realpath "$SCRIPT_DIR/../..")
echo "Projektverzeichnis: $PROJECT_DIR"

# Setze auf 'true', um die Prozesse im Hintergrund ohne neue Terminals zu starten.
# Bei 'false' werden neue Terminals für die Ausgabe geöffnet.
START_HIDDEN=false

# Setze auf 'false', damit die Terminals nach der Ausführung auf eine Eingabe warten.
# Nützlich für die Fehlersuche.
AUTO_CLOSE_TERMINAL=false

# Funktion zum Aufräumen von Hintergrundprozessen beim Beenden
cleanup() {
    echo "Säubere Prozesse..."
    # Wenn die PIDs noch existieren, versuche sie zu beenden
    if [ ! -z "$TEST_SERVER_PID" ] && kill -0 $TEST_SERVER_PID 2>/dev/null; then
        echo "Beende Test-Server (PID: $TEST_SERVER_PID)..."
        kill $TEST_SERVER_PID
    fi
    if [ ! -z "$SCHEDULER_PID" ] && kill -0 $SCHEDULER_PID 2>/dev/null; then
        echo "Beende Scheduler (PID: $SCHEDULER_PID)..."
        kill $SCHEDULER_PID
    fi
    if [ ! -z "$WORKER_PID" ] && kill -0 $WORKER_PID 2>/dev/null; then
        echo "Beende Worker (PID: $WORKER_PID)..."
        kill $WORKER_PID
    fi
    exit
}

# Trap für SIGINT (Ctrl+C) und EXIT
trap cleanup SIGINT EXIT

# Pfad zur Testkonfiguration
export NODE_CONFIG_PATH="$PROJECT_DIR/test/verification_test/test_config.js"
echo "Using test config: $NODE_CONFIG_PATH"

# Log-Dateien für diesen Testlauf
TEST_SERVER_LOG="$PROJECT_DIR/test/verification_test/test_server.log"
SCHEDULER_LOG="$PROJECT_DIR/test/verification_test/scheduler.log"
WORKER_LOG="$PROJECT_DIR/test/verification_test/worker.log"
# Alte Logs löschen
rm -f $TEST_SERVER_LOG $SCHEDULER_LOG $WORKER_LOG

# Pfade zu den Skripten (relativ zum Projektverzeichnis)
TEST_SERVER_PATH="test/verification_test/test_server.js"
SCHEDULER_PATH="Server/scheduler.js"
WORKER_PATH="Client/worker.js"

# Startet den Test-Server immer im Hintergrund
echo "Starte Test-Server im Hintergrund..."
(cd "$PROJECT_DIR" && node $TEST_SERVER_PATH > $TEST_SERVER_LOG 2>&1) &
TEST_SERVER_PID=$!
echo "Test-Server gestartet mit PID: $TEST_SERVER_PID. Log: $TEST_SERVER_LOG"
echo "Warte kurz, damit der Test-Server starten kann..."
sleep 2 # Gibt dem Server einen Moment Zeit zum Starten.

if [ "$START_HIDDEN" = "true" ]; then
    echo "Log-Dateien für diesen Testlauf:"
    echo "Scheduler log: $SCHEDULER_LOG"
    echo "Worker log: $WORKER_LOG"

    # Startet den Scheduler als Hintergrundprozess und leitet die Ausgabe um.
    echo "Starte Scheduler im Hintergrund..."
    (cd "$PROJECT_DIR" && node $SCHEDULER_PATH > $SCHEDULER_LOG 2>&1) &
    SCHEDULER_PID=$!
    echo "Scheduler gestartet mit PID: $SCHEDULER_PID"

    # Kurze Pause, um sicherzustellen, dass der Scheduler bereit ist
    sleep 3

    # Startet den Worker als Hintergrundprozess und leitet die Ausgabe um.
    echo "Starte Worker im Hintergrund..."
    (cd "$PROJECT_DIR" && node $WORKER_PATH > $WORKER_LOG 2>&1) &
    WORKER_PID=$!
    echo "Worker gestartet mit PID: $WORKER_PID"

    echo "Warte auf Abschluss des Crawls... (Details in den .log Dateien)"
    wait $SCHEDULER_PID
    echo "Scheduler-Prozess beendet."
    wait $WORKER_PID
    echo "Worker-Prozess beendet."

    echo "Testlauf beendet. Führe Analyse aus..."
    # Führe das Analyse-Skript aus
    python3 "$PROJECT_DIR/test/verification_test/analyze_results.py"

else # START_HIDDEN is false
    echo "Starte Scheduler und Worker in neuen Terminals..."
    echo "Das Skript wartet, bis beide Terminals geschlossen werden, und startet dann die Analyse."

    if [ "$AUTO_CLOSE_TERMINAL" = "true" ]; then
        # Startet den Scheduler in einem neuen Terminal, das sich automatisch schließt.
        gnome-terminal --wait --working-directory="$PROJECT_DIR" --title="Scheduler" -- bash -c "echo '--- SCHEDULER ---'; node $SCHEDULER_PATH" &
    else
        # Startet den Scheduler in einem neuen Terminal, das auf eine Eingabe wartet.
        gnome-terminal --wait --working-directory="$PROJECT_DIR" --title="Scheduler" -- bash -c "echo '--- SCHEDULER ---'; node $SCHEDULER_PATH; echo; read -p 'Prozess beendet. Drücken Sie Enter, um das Fenster zu schließen.'" &
    fi
    SCHEDULER_PID=$!

    # Kurze Pause, um sicherzustellen, dass der Scheduler bereit ist
    sleep 3

    if [ "$AUTO_CLOSE_TERMINAL" = "true" ]; then
        # Startet den Worker in einem neuen Terminal, das sich automatisch schließt.
        gnome-terminal --wait --working-directory="$PROJECT_DIR" --title="Worker" -- bash -c "echo '--- WORKER ---'; node $WORKER_PATH" &
    else
        # Startet den Worker in einem neuen Terminal, das auf eine Eingabe wartet.
        gnome-terminal --wait --working-directory="$PROJECT_DIR" --title="Worker" -- bash -c "echo '--- WORKER ---'; node $WORKER_PATH; echo; read -p 'Prozess beendet. Drücken Sie Enter, um das Fenster zu schließen.'" &
    fi
    WORKER_PID=$!
    
    echo
    echo "Scheduler gestartet im Terminal mit PID: $SCHEDULER_PID"
    echo "Worker gestartet im Terminal mit PID: $WORKER_PID"
    echo "Warte auf die Schließung beider Terminals..."

    # Warte auf das Ende beider gnome-terminal Prozesse.
    wait $SCHEDULER_PID
    echo "Scheduler-Terminal geschlossen."
    wait $WORKER_PID
    echo "Worker-Terminal geschlossen."

    echo
    echo "Beide Prozesse beendet. Führe Analyse aus..."
    # Führe das Analyse-Skript aus
    python3 "$PROJECT_DIR/test/verification_test/analyze_results.py"
fi
