"""
proxyController.py
Modified version of the mitmproxy saveHar addon. Version Nov 14, 2024
https://github.com/mitmproxy/mitmproxy/blob/main/mitmproxy/addons/savehar.py

Modified for use in the bsync synchronisation framework
added HTTP control for manually setting har path and export
NOW WITH WEBSOCKET IPC

"""
"""Write flow objects to a HAR file"""

PROXY_DEBUG = False
# PROXY_IPC_PORT = 8766 # Entfernt, wird jetzt als Option übergeben

import asyncio
import websockets # type: ignore
import base64
import json
import logging
import zlib
import os # Hinzugefügt für os.stat
from collections.abc import Sequence
from datetime import datetime
from datetime import timezone
from typing import Any, Set

from mitmproxy import command
from mitmproxy import ctx
from mitmproxy import exceptions
from mitmproxy import flow
from mitmproxy import flowfilter
from mitmproxy import http
from mitmproxy import types
from mitmproxy import version
from mitmproxy.addonmanager import Loader
from mitmproxy.connection import Server
from mitmproxy.coretypes.multidict import _MultiDict
from mitmproxy.log import ALERT
from mitmproxy.utils import human
from mitmproxy.utils import strutils

logger = logging.getLogger(__name__)

# Global set to store active WebSocket connections
# Wird jetzt in der Klasse initialisiert, um sauberer zu sein
# websocket_connections: Set[websockets.WebSocketServerProtocol] = set()

class SaveHarCustom:
    def __init__(self) -> None:
        self.flows: list[flow.Flow] = []
        self.filt: flowfilter.TFilter | None = None
        self.first_request_timestamp_sent = False
        self.save_path = "/home/user/Downloads/testhttpdump.har" # Default
        self.ipc_port = 0 # Wird durch Option gesetzt

        # Dynamisch ctx.options.hardump überschreiben, falls hardump beim Start gesetzt wurde
        if ctx.options.hardump and ctx.options.hardump != self.save_path:
             self.save_path = ctx.options.hardump
        else:
            ctx.options.hardump = self.save_path # Stellt sicher, dass hardump den initialen Wert hat

        self.websocket_server = None
        self.websocket_connections: Set[websockets.WebSocketServerProtocol] = set()

    async def broadcast_event(self, event_data: dict):
        if self.websocket_connections:
            message = json.dumps(event_data)
            # Create a list of tasks for sending messages
            tasks = [asyncio.create_task(ws.send(message)) for ws in self.websocket_connections]
            # Wait for all tasks to complete or handle exceptions
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    ws_to_remove = list(self.websocket_connections)[i]
                    logger.error(f"Error broadcasting event to {ws_to_remove.remote_address}: {result}. Removing client.")
                    # self.websocket_connections.remove(ws_to_remove) # Vorsicht bei Modifikation während Iteration
                    # Stattdessen besser:
                    if ws_to_remove in self.websocket_connections: # Prüfen ob noch vorhanden
                        try:
                            await ws_to_remove.close() # Client aktiv schließen
                        except Exception:
                            pass # Ignorieren, falls schon geschlossen
                        self.websocket_connections.discard(ws_to_remove)

    async def send_response(self, websocket, command_id: str, status: str, message: str = "", data: dict = None):
        response_data = {
            "commandId": command_id,
            "status": status, # "success", "error", "info"
            "message": message
        }
        if data:
            response_data.update(data)
        try:
            await websocket.send(json.dumps(response_data))
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"WS Client {websocket.remote_address} disconnected before sending response for {command_id}")
            if websocket in self.websocket_connections:
                self.websocket_connections.remove(websocket)

    async def handle_websocket_command(self, websocket, command_data_str: str):
        try:
            command_data = json.loads(command_data_str)
            command_name = command_data.get("command")
            command_id = command_data.get("commandId")

            if not command_id:
                logger.error("Received WS command without commandId")
                return # No way to respond

            logger.info(f"IPC_WS_COMMAND_RECEIVED: {command_name} from {websocket.remote_address} with ID {command_id}")

            if command_name == "SET_HAR_PATH":
                path = command_data.get("path")
                if path:
                    self.save_path = path
                    ctx.options.hardump = self.save_path # Wichtig für mitmproxy interne Logik, falls es darauf zugreift
                    self.flows = []  # Flows für neuen Pfad zurücksetzen
                    self.first_request_timestamp_sent = False
                    logger.info(f"HAR path set to: {self.save_path} via WebSocket.")
                    await self.broadcast_event({"type": "HAR_PATH_SET", "path": self.save_path, "status": "success"})
                    await self.send_response(websocket, command_id, "success", f"HAR path set to {self.save_path}", {"path": self.save_path})
                else:
                    logger.error("SET_HAR_PATH command missing 'path' argument.")
                    await self.send_response(websocket, command_id, "error", "Missing 'path' argument for SET_HAR_PATH")

            elif command_name == "EXPORT_HAR":
                if not self.save_path:
                    logger.error("Cannot export HAR: save_path is not set.")
                    await self.send_response(websocket, command_id, "error", "HAR export failed: save_path not set.")
                    return
                
                flow_count_before_export = len(self.flows)
                if flow_count_before_export == 0:
                    logger.info("No flows to export.")
                    # Stelle sicher, dass self.save_path hier einen gültigen Wert für die Events hat, oder behandle es als optional
                    current_save_path = self.save_path or "unknown_path"
                    await self.broadcast_event({
                        "type": "HAR_EXPORT_COMPLETE", 
                        "path": current_save_path, 
                        "flow_count_exported": 0, 
                        "file_size_bytes": 0,
                        "file_size_pretty": human.pretty_size(0),
                        "status": "info", 
                        "message": "No flows to export"
                    })
                    await self.send_response(websocket, command_id, "info", "No flows to export.", {
                        "path": current_save_path, 
                        "flow_count_exported": 0,
                        "file_size_bytes": 0,
                        "file_size_pretty": human.pretty_size(0)
                    })
                    return

                try:
                    self.export_har_sync(self.flows, self.save_path) 

                    file_size_info = {"bytes": -1, "pretty": "N/A"}
                    try:
                        file_stat = os.stat(self.save_path)
                        file_size_info["bytes"] = file_stat.st_size
                        file_size_info["pretty"] = human.pretty_size(file_stat.st_size)
                    except OSError as e:
                        logger.warning(f"Could not get file size for {self.save_path} after export: {e}")

                    logger.info(f"HAR exported to {self.save_path} with {flow_count_before_export} flows ({file_size_info['pretty']}) via WebSocket command.")
                    await self.broadcast_event({
                        "type": "HAR_EXPORT_COMPLETE", 
                        "path": self.save_path, 
                        "flow_count_exported": flow_count_before_export, 
                        "file_size_bytes": file_size_info["bytes"],
                        "file_size_pretty": file_size_info["pretty"],
                        "status": "success"
                    })
                    await self.send_response(websocket, command_id, "success", 
                        f"HAR exported to {self.save_path} ({file_size_info['pretty']})", 
                        {
                            "path": self.save_path, 
                            "flow_count_exported": flow_count_before_export,
                            "file_size_bytes": file_size_info["bytes"],
                            "file_size_pretty": file_size_info["pretty"]
                        }
                    )
                    self.flows = [] 
                    self.first_request_timestamp_sent = False
                    await self.broadcast_event({"type": "FLOWS_CLEARED", "reason": "Post HAR Export", "count": len(self.flows)})

                except Exception as e:
                    logger.error(f"Error during HAR export via WebSocket: {str(e)}")
                    await self.send_response(websocket, command_id, "error", f"HAR export failed: {str(e)}")

            elif command_name == "CLEAR_FLOWS":
                count_before = len(self.flows)
                self.flows = []
                self.first_request_timestamp_sent = False
                logger.info(f"Flows cleared via WebSocket. Count before: {count_before}, after: {len(self.flows)}")
                await self.broadcast_event({"type": "FLOWS_CLEARED", "reason": "Command", "count": len(self.flows), "count_before": count_before})
                await self.send_response(websocket, command_id, "success", f"Flows cleared. Count before: {count_before}", {"count_after": len(self.flows)})

            elif command_name == "SHUTDOWN":
                logger.info("Shutdown command received via WebSocket. Shutting down proxy.")
                await self.send_response(websocket, command_id, "success", "Proxy shutting down.")
                # Gracefully close all WebSocket connections before shutting down mitmproxy
                for ws_conn in list(self.websocket_connections): # Iterate over a copy
                    if ws_conn != websocket: # Don't try to close the current one again if it's in the list
                         try:
                            await ws_conn.close(code=1000, reason="Proxy shutting down")
                         except Exception: pass # ignore errors if already closed
                if websocket: # Ensure the commanding websocket is also closed
                    try:
                        await websocket.close(code=1000, reason="Proxy shutting down")
                    except Exception: pass

                self.websocket_connections.clear()
                
                if self.websocket_server:
                    self.websocket_server.close()
                    await self.websocket_server.wait_closed()
                    logger.info("WebSocket server stopped.")

                ctx.master.shutdown()
            else:
                logger.warning(f"Unknown WebSocket command: {command_name}")
                await self.send_response(websocket, command_id, "error", f"Unknown command: {command_name}")

        except json.JSONDecodeError:
            logger.error(f"Failed to decode JSON from WebSocket: {command_data_str}")
            # Cannot send response if command_id is unknown
        except Exception as e:
            logger.error(f"Error processing WebSocket command: {e}", exc_info=True)
            if command_id: # Try to send an error response if we have an ID
                 await self.send_response(websocket, command_id, "error", f"Internal server error: {str(e)}")

    async def websocket_handler(self, websocket: websockets.WebSocketServerProtocol, path: str = None):
        logger.info(f"IPC_WS_CLIENT_CONNECTED: {websocket.remote_address}")
        self.websocket_connections.add(websocket)

        # Send initial status to the newly connected client
        # This ensures the client knows the proxy is ready even if it connected
        # after the initial "MITMPROXY_READY" broadcast during startup.
        initial_events_sent = False
        try:
            await websocket.send(json.dumps({"type": "PROXY_EVENT", "event": "WEBSOCKET_LISTENING", "port": self.ipc_port}))
            await websocket.send(json.dumps({"type": "PROXY_EVENT", "event": "MITMPROXY_READY"}))
            if hasattr(self, 'save_path') and self.save_path:
                 await websocket.send(json.dumps({"type": "HAR_PATH_SET", "path": self.save_path, "status": "info", "message": "Current HAR path on connect."}))
            initial_events_sent = True
            logger.info(f"Sent initial status/ready events to newly connected client {websocket.remote_address}")
        except websockets.exceptions.ConnectionClosed:
            logger.warning(f"WS Client {websocket.remote_address} disconnected before initial status could be fully sent.")
            self.websocket_connections.discard(websocket)
            # Do not proceed if the client disconnected during handshake
            return
        except Exception as e:
            logger.error(f"Error sending initial status to {websocket.remote_address}: {e}")
            # Depending on the error, we might still want to proceed or close the connection.
            # For now, we'll proceed but log the error.

        # Only broadcast CLIENT_CONNECTED if initial events were sent successfully or were not critical for this stage
        if initial_events_sent : # Or a more nuanced check if some initial events are optional
            await self.broadcast_event({"type": "PROXY_EVENT", "event": "CLIENT_CONNECTED", "client": str(websocket.remote_address), "message": "Client successfully initialized."})
        else:
            # If initial events failed critically, we might not want to fully register this client,
            # or handle it as a partially initialized client.
            # For now, we still broadcast a connection event but with a warning.
            logger.warning(f"Broadcasting CLIENT_CONNECTED for {websocket.remote_address} despite issues with initial event sending.")
            await self.broadcast_event({"type": "PROXY_EVENT", "event": "CLIENT_CONNECTED", "client": str(websocket.remote_address), "message": "Client connected, but initial status sync might have issues."})
            
        try:
            async for message in websocket:
                await self.handle_websocket_command(websocket, message)
        except websockets.exceptions.ConnectionClosedError:
            logger.info(f"IPC_WS_CLIENT_DISCONNECTED_ERROR: {websocket.remote_address} (ConnectionClosedError)")
        except websockets.exceptions.ConnectionClosedOK:
            logger.info(f"IPC_WS_CLIENT_DISCONNECTED_OK: {websocket.remote_address} (ConnectionClosedOK)")
        except Exception as e:
            logger.error(f"IPC_WS_UNEXPECTED_ERROR with client {websocket.remote_address}: {e}", exc_info=True)
        finally:
            logger.info(f"IPC_WS_REMOVING_CLIENT: {websocket.remote_address}")
            self.websocket_connections.discard(websocket)
            await self.broadcast_event({"type": "PROXY_EVENT", "event": "CLIENT_DISCONNECTED", "client": str(websocket.remote_address)})

    # @command.command("save.har") # Diese Funktion wird nicht mehr als mitmproxy command benötigt
    def export_har_sync(self, flows: Sequence[flow.Flow], path: types.Path) -> None: # Umbenannt zu _sync für Klarheit
        """Export flows to an HAR (HTTP Archive) file (Synchronous version for internal calls)."""
        # print("IPC_Starting HAR export...", flush=True) # Ersetzt durch WS Event

        har_data_dict = self.make_har(flows)
        har_data_bytes = json.dumps(har_data_dict, indent=4).encode()

        if PROXY_DEBUG: logger.debug("IPC_IN_HAR_EXPORT_PROCESS")

        if path.endswith(".zhar"):
            har_data_bytes = zlib.compress(har_data_bytes, 9)

        try:
            with open(path, "wb") as f:
                f.write(har_data_bytes)
            logger.info(f"HAR file saved to {path} ({human.pretty_size(len(har_data_bytes))} bytes).")
        except IOError as e:
            logger.error(f"Failed to write HAR file to {path}: {e}")
            raise # Wichtig, damit der Aufrufer den Fehler mitbekommt

        if PROXY_DEBUG: logger.debug(f"IPC_Flows count after export: {len(self.flows)}") # Flows werden jetzt im WS command Handler geleert

    def request(self, flow: http.HTTPFlow) -> None:
        # HTTP based control is removed, all control via WebSocket.
        # Erfassen des Zeitpunkts des ersten Requests, der kein Kontrollfluss ist
        if not self.first_request_timestamp_sent and not (".proxy.local" in flow.request.pretty_url): # proxy.local wird nicht mehr genutzt
            # Überprüfen, ob ein HAR-Pfad gesetzt ist (d.h. ctx.options.hardump hat einen Wert oder self.save_path ist nicht der Defaultwert oder leer)
            # Die Logik in __init__ stellt sicher, dass self.save_path und ctx.options.hardump synchron sind.
            # Ein sinnvoller HAR-Pfad ist eine gute Indikation, dass die Aufzeichnung aktiv ist.
            # Die Default-Initialisierung ist "/home/user/Downloads/testhttpdump.har".
            # Wenn der Pfad explizit via SET_HAR_PATH (oder Startup-Option) gesetzt wurde, dann ist es "aktiv".
            # Wir wollen nicht loggen, wenn der Proxy nur läuft, ohne dass ein spezifischer Speicherort für HARs definiert wurde.
            if self.save_path and self.save_path != "/home/user/Downloads/testhttpdump.har": # Prüft, ob sich der Pfad vom Default geändert hat
                                                                                            # oder ob ctx.options.hardump gesetzt wurde, was self.save_path aktualisiert.
                                                                                            # Besser: Prüfen, ob der Pfad von einem Client explizit gesetzt wurde.
                                                                                            # Oder eine explizite Variable `is_recording_active`.
                                                                                            # Fürs Erste: Wenn der save_path nicht mehr der initiale Default ist, nehmen wir an, es ist eine aktive Aufzeichnung.
                                                                                            # Oder einfacher: Immer loggen, wenn `self.save_path` einen Wert hat (ctx.options.hardump wird in __init__ auf self.save_path gesetzt)
                timestamp = datetime.now(timezone.utc).isoformat()
                log_entry = {
                    "type": "FIRST_WEBSITE_REQUEST",
                    "timestamp": timestamp,
                    "url": flow.request.pretty_url,
                    "method": flow.request.method,
                }
                asyncio.create_task(self.broadcast_event(log_entry))
                self.first_request_timestamp_sent = True

    def make_har(self, flows: Sequence[flow.Flow]) -> dict:
        entries = []
        skipped = 0
        servers_seen: set[Server] = set()

        for f in flows:
            if isinstance(f, http.HTTPFlow):
                entries.append(self.flow_entry(f, servers_seen))
            else:
                skipped += 1

        if skipped > 0:
            logger.info(f"Skipped {skipped} flows that weren't HTTP flows.")

        return {
            "log": {
                "version": "1.2",
                "creator": {
                    "name": "mitmproxy_bsync_addon", # Geänderter Name
                    "version": version.VERSION,
                    "comment": "",
                },
                "pages": [],
                "entries": entries,
            }
        }

    async def start_websocket_server(self):
        # Stellt sicher, dass der Server nicht mehrfach gestartet wird (obwohl __init__ das verhindern sollte)
        if self.websocket_server is not None:
            logger.warning("WebSocket server already started or starting.")
            return

        try:
            # Verwendung von partial, um self.websocket_handler mit dem self-Argument zu versehen
            # self.websocket_server = await websockets.serve(self.websocket_handler, "localhost", PROXY_IPC_PORT)
            # Besser ist es, den Server direkt in der asyncio event loop von mitmproxy zu starten,
            # das passiert implizit, wenn man es im 'running' hook macht.

            # Der Server wird jetzt in `async def running(self)` gestartet.
            # Hier nur die Info, dass es gestartet wird.
            logger.info(f"Attempting to start WebSocket server on port {self.ipc_port}...")
            # Das eigentliche Starten passiert in running()
            
        except Exception as e:
            logger.error(f"Failed to start WebSocket server: {e}", exc_info=True)
            # Hier könnten wir ctx.master.shutdown() aufrufen, wenn der WS kritisch ist.

    def load(self, loader: Loader):
        loader.add_option(
            "hardump", # hardump Option bleibt bestehen, falls man es beim Start setzen will
            str,
            "", # Default ist leer, wird von self.save_path in __init__ überschrieben oder gesetzt
            """
            Save a HAR file with all flows on exit. (Primarily controlled via WebSocket now)
            You may select particular flows by setting save_stream_filter.
            For mitmdump, enabling this option will mean that flows are kept in memory.
            """,
        )
        loader.add_option(
            name="ipc_port",
            typespec=int,
            default=8765,  # Defaultwert, falls nicht übergeben
            help="Port for WebSocket IPC communication with the Node.js controller."
        )
        asyncio.create_task(self.broadcast_event({"type": "PROXY_EVENT", "event": "MITMPROXY_LOADED"}))

    async def running(self):
        """Called when the proxy is fully started and the event loop is running."""
        try:
            # Starte den WebSocket Server hier, damit er in der mitmproxy asyncio event loop läuft.
            self.websocket_server = await websockets.serve(
                self.websocket_handler, 
                "localhost", 
                self.ipc_port, # Verwende den aus Optionen geladenen Port
                # Optional: Ping-Konfiguration, um tote Verbindungen schneller zu erkennen
                ping_interval=20, 
                ping_timeout=20
            )
            logger.info(f"IPC_WS_SERVER_LISTENING on ws://localhost:{self.ipc_port}")
            await self.broadcast_event({"type": "PROXY_EVENT", "event": "MITMPROXY_READY"}) # MITMPROXY_READY signalisiert, dass alles läuft
            await self.broadcast_event({"type": "PROXY_EVENT", "event": "WEBSOCKET_LISTENING", "port": self.ipc_port})

        except OSError as e: # Z.B. wenn der Port schon belegt ist
            logger.error(f"Could not start WebSocket server on port {self.ipc_port}: {e}. Proxy will shut down.")
            await self.broadcast_event({"type": "ERROR", "context": "WEBSOCKET_STARTUP", "message": f"Failed to start WebSocket server: {e}"})
            ctx.master.shutdown() # Proxy beenden, wenn WS nicht starten kann
        except Exception as e:
            logger.error(f"Unexpected error starting WebSocket server: {e}", exc_info=True)
            await self.broadcast_event({"type": "ERROR", "context": "WEBSOCKET_STARTUP", "message": f"Unexpected error starting WebSocket server: {e}"})
            ctx.master.shutdown()

    def configure(self, updated):
        if "save_stream_filter" in updated:
            if ctx.options.save_stream_filter:
                try:
                    self.filt = flowfilter.parse(ctx.options.save_stream_filter)
                except ValueError as e:
                    raise exceptions.OptionsError(str(e)) from e
            else:
                self.filt = None

        if "ipc_port" in updated:
            if ctx.options.ipc_port:
                self.ipc_port = ctx.options.ipc_port
                logger.info(f"IPC WebSocket port set to: {self.ipc_port}")
            else:
                # Fallback oder Fehler, falls ipc_port nicht gesetzt ist, obwohl es sollte
                logger.warning("ipc_port option is not set or invalid. Using default or previous value.")
                if not self.ipc_port: # Wenn noch kein Port gesetzt war (z.B. beim ersten Laden)
                    self.ipc_port = 8765 # Setze einen Default, wenn ctx.options.ipc_port leer ist
                    logger.info(f"IPC WebSocket port defaulted to: {self.ipc_port}")

        if "hardump" in updated: # Diese Option wird jetzt primär über WS gesteuert (self.save_path)
            if ctx.options.hardump and ctx.options.hardump != self.save_path : # Wenn über Kommandozeile anders gesetzt
                self.save_path = ctx.options.hardump
                logger.info(f"HAR dump path updated by mitmproxy option to: {self.save_path}")
                self.flows = []
                self.first_request_timestamp_sent = False
                asyncio.create_task(self.broadcast_event({"type": "HAR_PATH_SET", "path": self.save_path, "status": "info", "message": "Set by mitmproxy startup option."}))

            elif not ctx.options.hardump and self.save_path: # Wenn hardump Option geleert wird (sollte nicht passieren bei WS Steuerung)
                logger.warning("hardump option was unset, but save_path is managed by WebSocket. Consider this an edge case.")
                # self.flows = [] # Nicht unbedingt leeren, da save_path noch gesetzt sein kann
                # self.first_request_timestamp_sent = False
                # asyncio.create_task(self.broadcast_event({"type": "DEBUG", "message": "Flows potentially kept despite hardump option unset, as save_path is active."}))

    def response(self, flow: http.HTTPFlow) -> None:
        if flow.websocket is None:
            self._save_flow(flow)

    def error(self, flow: http.HTTPFlow) -> None:
        self.response(flow)

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        self._save_flow(flow)

    def _save_flow(self, flow: http.HTTPFlow) -> None:
        if ".proxy.local" in flow.request.pretty_url: # Sollte nicht mehr vorkommen
            return
        if ctx.options.hardump or self.save_path: # Prüfe beides, da hardump via WS (self.save_path) gesteuert wird
            flow_matches = self.filt is None or self.filt(flow)
            if flow_matches:
                self.flows.append(flow)
                #asyncio.create_task(self.broadcast_event({"type": "FLOW_UPDATE", "count": len(self.flows), "url": flow.request.pretty_url}))

    async def done(self): # Wird aufgerufen, wenn mitmproxy herunterfährt
        logger.info("Mitmproxy is shutting down. Cleaning up WebSocket server.")
        if self.websocket_server:
            self.websocket_server.close()
            try:
                await asyncio.wait_for(self.websocket_server.wait_closed(), timeout=5.0)
                logger.info("WebSocket server successfully closed.")
            except asyncio.TimeoutError:
                logger.warning("Timeout waiting for WebSocket server to close.")
        
        # Schließe verbleibende Client-Verbindungen, falls noch welche offen sind
        for ws_conn in list(self.websocket_connections):
            try:
                await ws_conn.close(code=1001, reason="Server shutting down")
            except Exception:
                pass # Ignoriere Fehler, wenn die Verbindung bereits geschlossen ist
        self.websocket_connections.clear()

        # Optional: HAR speichern beim Beenden, falls `hardump` gesetzt ist und nicht leer ist
        # Dies ist das ursprüngliche Verhalten von saveHAR, falls gewünscht
        # if ctx.options.hardump and ctx.options.hardump != "-" and self.flows:
        #    logger.info(f"Saving HAR on exit to {ctx.options.hardump} due to hardump option.")
        #    try:
        #        self.export_har_sync(self.flows, ctx.options.hardump)
        #    except Exception as e:
        #        logger.error(f"Failed to save HAR on exit: {e}")

    def flow_entry(self, flow: http.HTTPFlow, servers_seen: set[Server]) -> dict:
        """Creates HAR entry from flow"""

        if flow.server_conn in servers_seen:
            connect_time = -1.0
            ssl_time = -1.0
        elif flow.server_conn.timestamp_tcp_setup:
            assert flow.server_conn.timestamp_start
            connect_time = 1000 * (
                flow.server_conn.timestamp_tcp_setup - flow.server_conn.timestamp_start
            )

            if flow.server_conn.timestamp_tls_setup:
                ssl_time = 1000 * (
                    flow.server_conn.timestamp_tls_setup
                    - flow.server_conn.timestamp_tcp_setup
                )
            else:
                ssl_time = -1.0
            servers_seen.add(flow.server_conn)
        else:
            connect_time = -1.0
            ssl_time = -1.0

        if flow.request.timestamp_end:
            send = 1000 * (flow.request.timestamp_end - flow.request.timestamp_start)
        else:
            send = 0

        if flow.response and flow.request.timestamp_end:
            wait = 1000 * (flow.response.timestamp_start - flow.request.timestamp_end)
        else:
            wait = 0

        if flow.response and flow.response.timestamp_end:
            receive = 1000 * (
                flow.response.timestamp_end - flow.response.timestamp_start
            )

        else:
            receive = 0

        timings: dict[str, float | None] = {
            "connect": connect_time,
            "ssl": ssl_time,
            "send": send,
            "receive": receive,
            "wait": wait,
        }

        if flow.response:
            try:
                content = flow.response.content
            except ValueError:
                content = flow.response.raw_content
            response_body_size = (
                len(flow.response.raw_content) if flow.response.raw_content else 0
            )
            response_body_decoded_size = len(content) if content else 0
            response_body_compression = response_body_decoded_size - response_body_size
            response = {
                "status": flow.response.status_code,
                "statusText": flow.response.reason,
                "httpVersion": flow.response.http_version,
                "cookies": self.format_response_cookies(flow.response),
                "headers": self.format_multidict(flow.response.headers),
                "content": {
                    "size": response_body_size,
                    "compression": response_body_compression,
                    "mimeType": flow.response.headers.get("Content-Type", ""),
                },
                "redirectURL": flow.response.headers.get("Location", ""),
                "headersSize": len(str(flow.response.headers)),
                "bodySize": response_body_size,
            }
            if content and strutils.is_mostly_bin(content):
                response["content"]["text"] = base64.b64encode(content).decode()
                response["content"]["encoding"] = "base64"
            else:
                text_content = flow.response.get_text(strict=False)
                if text_content is None:
                    response["content"]["text"] = ""
                else:
                    response["content"]["text"] = text_content
        else:
            response = {
                "status": 0,
                "statusText": "",
                "httpVersion": "",
                "headers": [],
                "cookies": [],
                "content": {},
                "redirectURL": "",
                "headersSize": -1,
                "bodySize": -1,
                "_transferSize": 0,
                "_error": None,
            }
            if flow.error:
                response["_error"] = flow.error.msg

        if flow.request.method == "CONNECT":
            url = f"https://{flow.request.pretty_url}/"
        else:
            url = flow.request.pretty_url

        entry: dict[str, Any] = {
            "startedDateTime": datetime.fromtimestamp(
                flow.request.timestamp_start, timezone.utc
            ).isoformat(),
            "time": sum(v for v in timings.values() if v is not None and v >= 0),
            "request": {
                "method": flow.request.method,
                "url": url,
                "httpVersion": flow.request.http_version,
                "cookies": self.format_multidict(flow.request.cookies),
                "headers": self.format_multidict(flow.request.headers),
                "queryString": self.format_multidict(flow.request.query),
                "headersSize": len(str(flow.request.headers)),
                "bodySize": len(flow.request.content) if flow.request.content else 0,
            },
            "response": response,
            "cache": {},
            "timings": timings,
        }

        if flow.request.method in ["POST", "PUT", "PATCH"]:
            params = self.format_multidict(flow.request.urlencoded_form)
            entry["request"]["postData"] = {
                "mimeType": flow.request.headers.get("Content-Type", ""),
                "text": flow.request.get_text(strict=False),
                "params": params,
            }

        if flow.server_conn.peername:
            entry["serverIPAddress"] = str(flow.server_conn.peername[0])

        websocket_messages = []
        if flow.websocket:
            for message in flow.websocket.messages:
                if message.is_text:
                    data = message.text
                else:
                    data = base64.b64encode(message.content).decode()
                websocket_message = {
                    "type": "send" if message.from_client else "receive",
                    "time": message.timestamp,
                    "opcode": message.type.value,
                    "data": data,
                }
                websocket_messages.append(websocket_message)

            entry["_resourceType"] = "websocket"
            entry["_webSocketMessages"] = websocket_messages
        return entry

    def format_response_cookies(self, response: http.Response) -> list[dict]:
        """Formats the response's cookie header to list of cookies"""
        cookie_list = response.cookies.items(multi=True)
        rv = []
        for name, (value, attrs) in cookie_list:
            cookie = {
                "name": name,
                "value": value,
                "path": attrs.get("path", "/"),
                "domain": attrs.get("domain", ""),
                "httpOnly": "httpOnly" in attrs,
                "secure": "secure" in attrs,
            }
            # TODO: handle expires attribute here.
            # This is not quite trivial because we need to parse random date formats.
            # For now, we just ignore the attribute.

            if "sameSite" in attrs:
                cookie["sameSite"] = attrs["sameSite"]

            rv.append(cookie)
        return rv

    def format_multidict(self, obj: _MultiDict[str, str]) -> list[dict]:
        return [{"name": k, "value": v} for k, v in obj.items(multi=True)]
    

addons = [SaveHarCustom()]
