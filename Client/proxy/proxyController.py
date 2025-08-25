"""
proxyController.py
Modified version of the mitmproxy saveHar addon. Version Nov 14, 2024
https://github.com/mitmproxy/mitmproxy/blob/main/mitmproxy/addons/savehar.py

Modified for use in the bsync synchronisation framework
added HTTP control for manually setting har path and export

"""
"""Write flow objects to a HAR file"""

PROXY_DEBUG = False

import base64
import json
import logging
import zlib
from collections.abc import Sequence
from datetime import datetime
from datetime import timezone
from typing import Any

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

def send_ipc_message(message_type: str, data: dict = None, debug_msg: str = None):
    """Send structured JSON message for IPC communication with Node.js"""
    message = {
        "type": message_type,
        "timestamp": datetime.now().isoformat(),
        "data": data or {}
    }
    
    if debug_msg:
        message["debug"] = debug_msg
    
    # Send JSON message with special prefix for easy detection
    print(f"IPC_JSON:{json.dumps(message)}", flush=True)

class SaveHarCustom:
    def __init__(self) -> None:
        self.flows: list[flow.Flow] = []
        # Keep a single canonical entry per mitmproxy flow using its id.
        # This lets us record request-only flows early and later enrich them
        # when a response or error occurs, without creating duplicates.
        self.flows_by_id: dict[str, flow.Flow] = {}
        self.filt: flowfilter.TFilter | None = None
        
        # Counter for requests in current iteration
        self.request_count = 0
        self.iteration_active = False

        # Internal state for managing the HAR save path, independent of mitmproxy's options.
        self.save_path = ""

        # If false, omit bodies (request/response) and websocket payloads from HAR
        self.include_payload: bool = False
        # If true, include CONNECT tunnel handshakes as HAR entries (not browser-visible HTTP).
        # Default False to match website/browser-level logging and OpenWPM http_instrument.
        self.include_connect_flows: bool = True
        # Page metadata for HAR pages
        self.current_page_url: str | None = None
        self.current_page_visit_ts: str | None = None  # ISO string
        self.current_page_index: str | None = None

    @command.command("save.har")
    def export_har(self) -> None:
        """
        Export flows to an HAR file.
        This copies the current flows and clears the internal list *immediately*
        to prevent data from one iteration leaking into the next.
        The export then proceeds on the copy.
        """
        # We operate on a copy of the canonical flow map.
        flows_to_export = list(self.flows_by_id.values())
        flows_before_clear = len(flows_to_export)

        # IMPORTANT: Clear the instance's flow list immediately.
        # This is the critical step to ensure isolation between crawl iterations.
        self.flows = []
        self.flows_by_id = {}
        self.request_count = 0
        # The iteration is not active until the next request comes in.
        # It's set to active in the _save_flow method.
        self.iteration_active = True 
        
        send_ipc_message("har_export_started", {
            "flows_count": flows_before_clear,
            "save_path": self.save_path,
            "include_payload": self.include_payload,
            "message": "Flows copied and live list cleared for export."
        })
        # Provide a quick sample of what we are about to export for debugging purposes
        if PROXY_DEBUG:
            sample = [
                {
                    "id": f.id,
                    "method": f.request.method if f.request else None,
                    "url": f.request.pretty_url if f.request else None,
                    "has_response": bool(getattr(f, "response", None)),
                    "has_error": bool(getattr(f, "error", None)),
                }
                for f in flows_to_export[:5]
            ]
            send_ipc_message("har_export_sample", {"sample": sample, "sample_size": len(sample)})

        try:
            har = json.dumps(self.make_har(flows_to_export), indent=4).encode()

            if PROXY_DEBUG: 
                send_ipc_message("debug", {"message": "IN_HAR_EXPORT_PROCESS"})

            if self.save_path.endswith(".zhar"):
                har = zlib.compress(har, 9)

            with open(self.save_path, "wb") as f:
                f.write(har)

            send_ipc_message("har_export_completed", {
                "file_path": self.save_path,
                "file_size": len(har),
                "flows_exported": flows_before_clear,
                "flows_remaining_in_proxy": len(self.flows_by_id) # Should always be 0
            })
        except Exception as e:
            # The flow list is already cleared, but we should log the export error.
            send_ipc_message("error", {
                "operation": "har_export",
                "error_message": str(e),
                "error_type": type(e).__name__,
                "failed_flows_count": flows_before_clear
            })

    def request(self, flow: http.HTTPFlow) -> None:

        """Handle shutdown request via HTTP"""
        if flow.request.pretty_url == "http://shutdown.proxy.local/":
            send_ipc_message("proxy_shutdown_requested", {
                "message": "Graceful shutdown requested via HTTP",
                "flows_count": len(self.flows_by_id)
            })
            
            # Perform cleanup before shutdown
            if self.flows_by_id:
                send_ipc_message("debug", {
                    "message": f"Clearing {len(self.flows_by_id)} flows before shutdown"
                })
                self.flows = []
                self.flows_by_id = {}
            
            # Shutdown the proxy
            ctx.master.shutdown()
            send_ipc_message("proxy_shutdown_requested", {
                "message": "Graceful shutdown tried via HTTP",
                "flows_count": len(self.flows_by_id)
            })
            return

        """Handle hardump request via HTTP"""
        if flow.request.pretty_url == "http://harddump.proxy.local/":
            send_ipc_message("hardump_requested", {"flows_count": len(self.flows_by_id)})
            if self.save_path:
                try:
                    self.export_har()
                except Exception as e:
                    send_ipc_message("error", {
                        "operation": "har_export_trigger",
                        "error_message": str(e),
                        "error_type": type(e).__name__
                    })
            else:
                 send_ipc_message("error", {
                    "operation": "har_export_trigger",
                    "error_message": "Cannot dump HAR, save_path is not set."
                })

        """Handle HAR path setting request"""
        if flow.request.pretty_url == "http://hardumppath.proxy.local/":
            # Get the HAR path from the request header
            har_path = flow.request.headers.get('X-Har-Path', '')
            if har_path:
                self.save_path = har_path
                send_ipc_message("har_path_set", {"har_path": har_path})
        
        # Handle page metadata for HAR pages
        if flow.request.pretty_url == "http://setpage.proxy.local/":
            page_url = flow.request.headers.get('X-Page-Url', '')
            visit_ts = flow.request.headers.get('X-Visit-Timestamp', '')
            url_index = flow.request.headers.get('X-Url-Index', '')
            if page_url and visit_ts:
                self.current_page_url = page_url
                self.current_page_visit_ts = visit_ts
                self.current_page_index = url_index or None
                send_ipc_message("page_metadata_set", {
                    "page_url": self.current_page_url,
                    "visit_timestamp": self.current_page_visit_ts,
                    "url_index": self.current_page_index,
                })
            return

        # Clear HAR flows
        if flow.request.pretty_url == "http://clearflows.proxy.local/":
            flows_before_clear = len(self.flows_by_id)
            self.flows = []
            self.flows_by_id = {}
            send_ipc_message("flows_cleared", {
                "flows_before_clear": flows_before_clear,
                "flows_after_clear": len(self.flows_by_id)
            })

        if flow.request.pretty_url == "http://getharflows.proxy.local/":
            send_ipc_message("har_flows_info", {"flows_count": len(self.flows_by_id)})

        # Record the flow as early as possible so that request-only flows
        # (e.g., timeouts/aborts without a response) are included in the HAR.
        # _save_flow will no-op for control URLs under .proxy.local.
        self._save_flow(flow)

    def make_har(self, flows: Sequence[flow.Flow]) -> dict:
        entries = []
        skipped = 0
        # A list of server seen till now is maintained so we can avoid
        # using 'connect' time for entries that use an existing connection.
        servers_seen: set[Server] = set()

        for f in flows:
            if isinstance(f, http.HTTPFlow):
                entries.append(self.flow_entry(f, servers_seen))
            else:
                skipped += 1

        if skipped > 0:
            logger.info(f"Skipped {skipped} flows that weren't HTTP flows.")

        # Build pages array if page metadata is available
        pages: list[dict] = []
        if self.current_page_url and self.current_page_visit_ts:
            pages.append({
                "startedDateTime": self.current_page_visit_ts,
                "id": self.current_page_url,
                "title": self.current_page_url,
                "pageTimings": {}
            })

        return {
            "log": {
                "version": "1.2",
                "creator": {
                    "name": "mitmproxy",
                    "version": version.VERSION,
                    "comment": f"bsync mitmproxy HAR export; payload={'on' if self.include_payload else 'off'}",
                },
                "pages": pages,
                "entries": entries,
            }
        }

    def load(self, loader: Loader):
        loader.add_option(
            "hardump",
            str,
            "",
            """
            Save a HAR file with all flows on exit.
            You may select particular flows by setting save_stream_filter.
            For mitmdump, enabling this option will mean that flows are kept in memory.
            """,
        )
        send_ipc_message("proxy_loaded")

    def running(self):
        """Called when the proxy is fully started"""
        send_ipc_message("proxy_ready")

    def configure(self, updated):
        if "save_stream_filter" in updated:
            if ctx.options.save_stream_filter:
                try:
                    self.filt = flowfilter.parse(ctx.options.save_stream_filter)
                except ValueError as e:
                    raise exceptions.OptionsError(str(e)) from e
            else:
                self.filt = None

        if "hardump" in updated:
            # We no longer react to hardump option changes for automatic saving.
            # This is now fully controlled via HTTP requests.
            if not ctx.options.hardump:
                send_ipc_message("debug", {
                    "message": "hardump option cleared, but no action taken (manual control)."
                })

    def response(self, flow: http.HTTPFlow) -> None:
        # websocket flows will receive a websocket_end,
        # we don't want to persist them here already
        if flow.websocket is None:
            self._save_flow(flow)

    def error(self, flow: http.HTTPFlow) -> None:
        self.response(flow)

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        self._save_flow(flow)

    # Capture flows as early as possible so aborted/timeout requests are included.
    def requestheaders(self, flow: http.HTTPFlow) -> None:
        self._save_flow(flow)

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        self._save_flow(flow)

    # Include CONNECT requests (TLS tunnel setup). If TLS fails later, we still
    # retain a record for the attempted connection.
    def http_connect(self, flow: http.HTTPFlow) -> None:
        if self.include_connect_flows:
            self._save_flow(flow)

    # Also record on disconnect events, which may occur without a proper error.
    def clientdisconnect(self, layer) -> None:  # layer carries .flow for HTTP layers
        f = getattr(layer, "flow", None)
        if isinstance(f, http.HTTPFlow):
            self._save_flow(f)

    def serverdisconnect(self, layer) -> None:
        f = getattr(layer, "flow", None)
        if isinstance(f, http.HTTPFlow):
            self._save_flow(f)

    def _save_flow(self, flow: http.HTTPFlow) -> None:
        # Skip requests to *.proxy.local domains which are used for HTTP control
        if ".proxy.local" in flow.request.pretty_url:
            return
        # Skip CONNECT by default (proxy handshake is not a browser-level HTTP request)
        if flow.request.method == "CONNECT" and not self.include_connect_flows:
            return
            
        # Filter out Firefox/Mozilla background requests.
        ignored_hosts = [
            "detectportal.firefox.com",
            "firefox.settings.services.mozilla.com",
            "push.services.mozilla.com",
            "location.services.mozilla.com",
            "shavar.services.mozilla.com",
            "snippets.cdn.mozilla.net",
            "normandy.cdn.mozilla.net",
            "aus5.mozilla.org",
            "content-signature-2.cdn.mozilla.net",
            "mozilla.cloudflare-dns.com",
        ]
        if flow.request.host in ignored_hosts or "cdn.mozilla.net" in flow.request.host:
            return
            
        flow_matches = self.filt is None or self.filt(flow)
        if flow_matches:
            # Canonicalize by flow.id to avoid duplicates across request/response/error hooks
            existed = flow.id in self.flows_by_id
            previous = self.flows_by_id.get(flow.id)
            self.flows_by_id[flow.id] = flow

            if PROXY_DEBUG:
                if not existed:
                    send_ipc_message("flow_recorded", {
                        "id": flow.id,
                        "method": flow.request.method,
                        "url": flow.request.pretty_url,
                        "has_response": bool(flow.response),
                        "has_error": bool(flow.error),
                        "stored_count": len(self.flows_by_id),
                    })
                else:
                    # Report if a response or error appeared later
                    prev_has_resp = bool(previous and previous.response)
                    prev_has_err = bool(previous and previous.error)
                    if (not prev_has_resp and bool(flow.response)) or (not prev_has_err and bool(flow.error)):
                        send_ipc_message("flow_updated", {
                            "id": flow.id,
                            "method": flow.request.method,
                            "url": flow.request.pretty_url,
                            "has_response": bool(flow.response),
                            "has_error": bool(flow.error),
                            "stored_count": len(self.flows_by_id),
                        })
            
            # Check if this is the first request of the iteration
            if self.iteration_active and self.request_count == 0:
                self.request_count += 1
                send_ipc_message("first_request_detected", {
                    "method": flow.request.method,
                    "url": flow.request.pretty_url,
                    "host": flow.request.headers.get("Host", "unknown"),
                    "timestamp": flow.request.timestamp_start
                })
            elif self.iteration_active:
                self.request_count += 1

    # def done(self):
    #     if ctx.options.hardump:
    #         if ctx.options.hardump == "-":
    #             har = self.make_har(self.flows)
    #             print(json.dumps(har, indent=4))
    #         else:
    #             self.export_har(self.flows, ctx.options.hardump)

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
            if self.include_payload:
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
            # Store CONNECT target without explicit port
            url = f"https://{flow.request.host}/"
        else:
            url = flow.request.pretty_url

        # If it's a websocket, change the scheme to ws(s) to match OpenWPM
        if flow.websocket:
            if url.startswith("https://"):
                url = "wss://" + url[len("https://"):]
            elif url.startswith("http://"):
                url = "ws://" + url[len("http://"):]

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

        if self.include_payload and flow.request.method in ["POST", "PUT", "PATCH"]:
            params = self.format_multidict(flow.request.urlencoded_form)
            entry["request"]["postData"] = {
                "mimeType": flow.request.headers.get("Content-Type", ""),
                "text": flow.request.get_text(strict=False),
                "params": params,
            }

        if flow.server_conn.peername:
            entry["serverIPAddress"] = str(flow.server_conn.peername[0])

        if flow.websocket:
            entry["_resourceType"] = "websocket"
            if self.include_payload:
                websocket_messages = []
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
