const { spawn } = require('child_process');
const WebSocket = require('ws');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs'); // Falls für Pfad-Operationen benötigt

var ProxyDebug = false; // Show websocket messages in console
var ProxyShowFullOutput = false; // Show full mitmproxy output and HTTP requests in console

// Debug spawn string: mitmdump -s /home/user/Downloads/bsync/Client/proxy/proxyController.py 

// Hilfsfunktion, falls sie hier gebraucht wird, ansonsten aus spawnScripts importieren oder hier definieren
function colorize(text, color) {
    const colors = {
        reset: "\x1b[0m",
        fg: {
            black: "\x1b[30m",
            red: "\x1b[31m",
            green: "\x1b[32m",
            yellow: "\x1b[33m",
            blue: "\x1b[34m",
            magenta: "\x1b[35m",
            cyan: "\x1b[36m",
            white: "\x1b[37m",
            gray: "\x1b[90m"
        }
    };
    return colors.fg[color] + text + colors.reset;
}

const PROXY_IPC_PORT = 8765; // Muss mit Python-Skript übereinstimmen

class ProxyManager extends EventEmitter {
    constructor(workerConfig, baseConfig, clientName) {
        super();
        this.workerConfig = workerConfig;
        this.baseConfig = baseConfig;
        this.clientName = clientName; // Nützlich für Logging und ggf. Kommunikation
        this.proxyProcess = null;
        this.ws = null;
        this.proxyReady = false;
        this.harPathGlobal = null; // Wird hier verwaltet
        this.resolveProxyReadyPromise = null;
        this.rejectProxyReadyPromise = null;
        this.commandCallbacks = new Map(); // Für Antworten auf Befehle
        this.commandTimeout = 5000; // Timeout für Befehlsantworten
    }

    _generateCommandId() {
        return Math.random().toString(36).substring(2, 15);
    }

    async start() {
        if (this.proxyProcess && this.proxyProcess.pid) {
            console.log(colorize("PROXY_MANAGER:", "magenta") + " Proxy already running with PID:", this.proxyProcess.pid);
            if (this.proxyReady) {
                return Promise.resolve();
            }
            // Wenn Prozess läuft, aber nicht ready, warte auf das Ready-Event (oder Timeout)
            return new Promise((resolve, reject) => {
                this.resolveProxyReadyPromise = resolve;
                this.rejectProxyReadyPromise = reject;
                 // Timeout, falls der Proxy nicht innerhalb einer bestimmten Zeit bereit wird
                setTimeout(() => {
                    if (!this.proxyReady) {
                        this.emit('error', new Error('Proxy did not become ready in time after restart attempt.'));
                        if (this.rejectProxyReadyPromise) this.rejectProxyReadyPromise(new Error('Proxy did not become ready in time'));
                    }
                }, 15000); // 15 Sekunden Timeout
            });
        }

        return new Promise((resolve, reject) => {
            this.resolveProxyReadyPromise = resolve;
            this.rejectProxyReadyPromise = reject;

            const mitmArgs = [
                "--listen-host=" + this.workerConfig.proxy_host,
                "--listen-port=" + this.workerConfig.proxy_port,
                "-s", path.resolve(__dirname, "../proxy/proxyController.py"), // Pfad relativ zu proxyManager.js
                "-v", // Verbose für Debugging, später anpassen
                "--set=console_eventlog_verbosity=info", // mitmproxy interne Log-Level
                "--set=termlog_verbosity=warn",
                // Der hardump-Pfad wird nun dynamisch über Websocket gesetzt
                // IPC Port für Websocket-Kommunikation wird im Python-Skript fest codiert oder als Arg übergeben
                // Hier fügen wir den IPC Port als Argument hinzu, falls proxyController.py dies unterstützt
                // "--set", `ipc_port=${PROXY_IPC_PORT}` // Beispiel, muss in proxyController.py implementiert werden
                // "--set", `ipc_port=${this.workerConfig.proxy_ipc_port}` // Verwendet jetzt den Konfigurationswert
                "--set", `ipc_port=${this.baseConfig.proxy_ipc_port}` // Liest jetzt aus baseConfig
            ];

            console.log(colorize("PROXY_MANAGER:", "magenta") + " Spawning mitmdump with args: ", mitmArgs.join(" "));

            try {
                this.proxyProcess = spawn("mitmdump", mitmArgs, {
                    stdio: "pipe", // Wir wollen stdout/stderr abfangen
                    shell: true // Beibehalten, falls mitmdump im Pfad ist und direkt ausgeführt werden kann
                });
            } catch (e) {
                console.error(colorize("PROXY_MANAGER:", "red") + " Failed to spawn mitmproxy instance", e);
                this.emit('error', e);
                if (this.rejectProxyReadyPromise) this.rejectProxyReadyPromise(e);
                return;
            }

            console.log(colorize("PROXY_MANAGER:", "magenta") + " Spawned Proxy instance PID:", this.proxyProcess.pid, "listening to " + this.workerConfig.proxy_host + ":" + this.workerConfig.proxy_port);

            this.proxyProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();

                // Prints full mitmproxy output and HTTP requests
                if (ProxyShowFullOutput) {
                    console.log(colorize("MITMPROXY_STDOUT:", "gray") + " " + output); // Debug Output 
                }

                // Initial sehr einfache Erkennung, wird durch Websocket ersetzt
                // if (output.includes("IPC: Websocket Server listening")) {
                //     this._connectWebSocket();
                // }
            });

            this.proxyProcess.stderr.on('data', (data) => {
                const errorOutput = data.toString().trim();
                console.error(colorize("MITMPROXY_STDERR:", "red") + " " + errorOutput);
                // Ein Fehler auf stderr bedeutet nicht immer, dass der Proxy nicht startet (z.B. Warnungen)
                // Kritische Fehler (z.B. Adresse schon belegt) müssen hier ggf. erkannt werden.
                if (errorOutput.includes("Address already in use")) {
                    const err = new Error("Proxy address already in use.");
                    this.emit('error', err);
                    if (this.rejectProxyReadyPromise) this.rejectProxyReadyPromise(err);
                    this.proxyProcess = null; // Wichtig, da der Prozess nicht nutzbar ist
                }
            });

            this.proxyProcess.on('error', (err) => {
                console.error(colorize("PROXY_MANAGER:", "red") + " Failed to start mitmproxy process.", err);
                this.emit('error', err);
                if (this.rejectProxyReadyPromise) this.rejectProxyReadyPromise(err);
                this.proxyProcess = null;
            });

            this.proxyProcess.on('close', (code) => {
                console.log(colorize("PROXY_MANAGER:", "magenta") + ` mitmproxy process closed with code ${code}`);
                this.proxyReady = false;
                this.proxyProcess = null;
                if (this.ws) {
                    this.ws.terminate(); // Websocket sauber schließen
                    this.ws = null;
                }
                this.emit('close', code);
                // Wenn der Proxy unerwartet schließt, und wir auf 'ready' gewartet haben
                if (this.rejectProxyReadyPromise && !this.proxyReady) {
                    this.rejectProxyReadyPromise(new Error(`Mitmproxy process closed prematurely with code ${code}`));
                }
            });
            
            // Timeout für das Starten des Proxys selbst (nicht für das Ready-Event vom Websocket)
            setTimeout(() => {
                if (!this.proxyProcess || !this.proxyProcess.pid) {
                     const err = new Error('Proxy process did not spawn correctly within timeout');
                     this.emit('error', err);
                     if (this.rejectProxyReadyPromise) this.rejectProxyReadyPromise(err);
                } else if (!this.proxyReady) {
                    // Dieser Timeout ist für das *Websocket* ready, siehe _connectWebSocket
                }
            }, 10000); // 10 Sekunden Timeout für den Prozess-Spawn

            // Verbindung zum Websocket erst herstellen, wenn der Python-Prozess vermutlich läuft
            // Eine kleine Verzögerung kann helfen, bevor der Verbindungsversuch gestartet wird.
            setTimeout(() => {
                this._connectWebSocket();
            }, 1000); // 1 Sekunde Verzögerung
        });
    }

    _connectWebSocket() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            console.log(colorize("PROXY_MANAGER:", "yellow") + " WebSocket connection attempt already in progress or open.");
            return;
        }

        // const wsUrl = `ws://localhost:${this.workerConfig.proxy_ipc_port}`; // Verwendet jetzt den Konfigurationswert
        const wsUrl = `ws://localhost:${this.baseConfig.proxy_ipc_port}`; // Liest jetzt aus baseConfig
        console.log(colorize("PROXY_MANAGER:", "magenta") + ` Attempting to connect to WebSocket: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log(colorize("PROXY_MANAGER:", "green") + " WebSocket connection established.");
            // Normalerweise würde die "PROXY_EVENT:READY" Nachricht vom Server kommen.
            // Aber wir können hier schon mal signalisieren, dass der WS da ist.
            // Das eigentliche "Proxy ist bereit für HAR etc." kommt vom Python Teil.
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (ProxyDebug) {
                    console.log(colorize("PROXY_MANAGER_WS_RX:", "cyan"), message);
                }

                if (message.commandId && this.commandCallbacks.has(message.commandId)) {
                    const { resolve, reject, timeout } = this.commandCallbacks.get(message.commandId);
                    clearTimeout(timeout);
                    if (message.status === 'success' || message.status === 'info') {
                        resolve(message);
                    } else {
                        reject(new Error(message.message || "Command failed"));
                    }
                    this.commandCallbacks.delete(message.commandId);
                    return;
                }

                switch (message.type) {
                    case "PROXY_EVENT":
                        if (message.event === "MITMPROXY_READY" || message.event === "WEBSOCKET_LISTENING") { // Oder spezifischeres Event von Python
                            if (!this.proxyReady) { // Nur beim ersten Mal
                                this.proxyReady = true;
                                this.emit('ready');
                                if (this.resolveProxyReadyPromise) this.resolveProxyReadyPromise();
                                this.resolveProxyReadyPromise = null;
                                this.rejectProxyReadyPromise = null;
                            }
                        }
                        // Weitere PROXY_EVENTs (LOADED etc.)
                        this.emit('proxy_event', message);
                        break;
                    case "HAR_PATH_SET":
                        this.emit('harPathSet', message); // message enthält { path, status, message? }
                        break;
                    case "FIRST_WEBSITE_REQUEST":
                        this.emit('firstWebsiteRequest', message); // message enthält { timestamp, url, method }
                        break;
                    case "FLOW_UPDATE":
                        this.emit('flowUpdate', message); // message enthält { count, last_url }
                        break;
                    case "HAR_EXPORT_COMPLETE":
                        this.emit('harExportComplete', message); // message enthält { path, flow_count_exported, status }
                        break;
                    case "FLOWS_CLEARED":
                        this.emit('flowsCleared', message); // message enthält { reason, count }
                        break;
                    case "ERROR":
                        console.error(colorize("PROXY_MANAGER_WS_ERROR:", "red"), message);
                        this.emit('proxy_error', message); // Spezifisches Event für Fehler vom Python-Teil
                        break;
                    default:
                        console.log(colorize("PROXY_MANAGER_WS_UNKNOWN:", "yellow"), "Received unknown message type:", message.type);
                }
            } catch (e) {
                console.error(colorize("PROXY_MANAGER:", "red") + " Error parsing WebSocket message or in handler:", e);
                console.error(colorize("PROXY_MANAGER:", "red") + " Raw WS message: " + data.toString());
            }
        });

        this.ws.on('close', (code, reason) => {
            console.log(colorize("PROXY_MANAGER:", "yellow") + ` WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
            this.ws = null;
            if (this.proxyReady) { // Wenn Verbindung während des Betriebs abbricht
                this.proxyReady = false;
                this.emit('disconnect'); // Signalisiert, dass der Proxy nicht mehr kommunikationsbereit ist
            }
            // Wenn wir auf das Ready-Signal gewartet haben und der WS schließt vorher
            if (this.rejectProxyReadyPromise && !this.proxyReady) {
                 this.rejectProxyReadyPromise(new Error(`WebSocket closed before proxy became ready. Code: ${code}, Reason: ${reason}`));
            }
        });

        this.ws.on('error', (err) => {
            console.error(colorize("PROXY_MANAGER:", "red") + " WebSocket error:", err.message);
            if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                 // Fehler beim Verbindungsaufbau
                if (this.rejectProxyReadyPromise && !this.proxyReady) {
                     this.rejectProxyReadyPromise(new Error(`WebSocket connection error: ${err.message}`));
                }
            }
            this.emit('error', err); // Allgemeines Fehlerereignis
            // Schließen und erneutes Verbinden könnte hier implementiert werden, falls gewünscht.
            if (this.ws) {
                this.ws.terminate();
                this.ws = null;
            }
        });
    }

    async _sendCommand(commandPayload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error("WebSocket is not connected."));
        }
        const commandId = this._generateCommandId();
        const payloadWithId = { ...commandPayload, commandId };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.commandCallbacks.delete(commandId);
                reject(new Error(`Command '${commandPayload.command}' timed out after ${this.commandTimeout}ms`));
            }, this.commandTimeout);

            this.commandCallbacks.set(commandId, { resolve, reject, timeout });
            this.ws.send(JSON.stringify(payloadWithId));
            if (ProxyDebug) {
                console.log(colorize("PROXY_MANAGER_WS_TX:", "blue"), payloadWithId);
            }
        });
    }

    async setHarPath(harPath) { // Der vollständige Pfad wird nun direkt übergeben
        if (!this.proxyReady) return Promise.reject(new Error("Proxy not ready to set HAR path."));
        this.harPathGlobal = harPath; // Lokale Kopie
        try {
            const response = await this._sendCommand({ command: "SET_HAR_PATH", path: harPath });
            // if (ProxyDebug) console.log(colorize("PROXY_MANAGER:", "magenta") + ` SET_HAR_PATH response:`, response);
            if (response.status !== 'success') {
                 throw new Error(response.message || `Failed to set HAR path to ${harPath}`);
            }
            return response; // Enthält { path, status }
        } catch (error) {
            console.error(colorize("PROXY_MANAGER:", "red") + ` Error setting HAR path:`, error);
            this.emit('error', new Error(`Failed to set HAR path: ${error.message}`));
            throw error;
        }
    }

    async requestHarExport() {
        if (!this.proxyReady) return Promise.reject(new Error("Proxy not ready to export HAR."));
        if (!this.harPathGlobal) return Promise.reject(new Error("HAR path not set, cannot export."));
        
        try {
            const response = await this._sendCommand({ command: "EXPORT_HAR" }); // Path wird serverseitig aus self.save_path genommen
            // if (ProxyDebug) console.log(colorize("PROXY_MANAGER:", "magenta") + ` EXPORT_HAR response:`, response);
             if (response.status !== 'success' && response.status !== 'info') { // info for no flows
                throw new Error(response.message || `Failed to export HAR`);
            }
            return response; // Enthält { path, flow_count_exported, status }
        } catch (error) {
            console.error(colorize("PROXY_MANAGER:", "red") + ` Error requesting HAR export:`, error);
            this.emit('error', new Error(`Failed to request HAR export: ${error.message}`));
            throw error;
        }
    }
    
    async clearFlows() {
        if (!this.proxyReady) return Promise.reject(new Error("Proxy not ready to clear flows."));
        try {
            const response = await this._sendCommand({ command: "CLEAR_FLOWS" });
            console.log(colorize("PROXY_MANAGER:", "magenta") + ` CLEAR_FLOWS response:`, response);
            if (response.status !== 'success') {
                 throw new Error(response.message || `Failed to clear flows`);
            }
            return response; // Enthält { count, status }
        } catch (error) {
            console.error(colorize("PROXY_MANAGER:", "red") + ` Error clearing flows:`, error);
            this.emit('error', new Error(`Failed to clear flows: ${error.message}`));
            throw error;
        }
    }

    async shutdown() {
        console.log(colorize("PROXY_MANAGER:", "magenta") + " Attempting to shutdown proxy...");
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                await this._sendCommand({ command: "SHUTDOWN" });
                // WS schließt sich dann serverseitig, was 'close' Event auslöst
            } catch (error) {
                console.error(colorize("PROXY_MANAGER:", "red") + " Error sending SHUTDOWN command, forcing kill:", error.message);
            }
        }
        
        // Fallback: Prozess manuell beenden, falls WS nicht (mehr) verbunden ist oder Befehl fehlschlägt
        if (this.proxyProcess && this.proxyProcess.pid) {
            console.log(colorize("PROXY_MANAGER:", "magenta") + " Forcing kill on proxy process PID:", this.proxyProcess.pid);
            const killed = this.proxyProcess.kill("SIGINT"); // SIGINT versuchen für sauberes Beenden
            if (!killed) {
                 console.error(colorize("PROXY_MANAGER:", "red") + " Failed to kill proxy process with SIGINT, trying SIGTERM.");
                 this.proxyProcess.kill("SIGTERM");
            }
            // Kurze Zeit geben, damit der 'close'-Handler des Prozesses auslöst
            return new Promise(resolve => setTimeout(resolve, 1000));
        }
        this.proxyReady = false;
        this.proxyProcess = null;
        return Promise.resolve();
    }
}

module.exports = ProxyManager; 