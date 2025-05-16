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

class SaveHarCustom:
    def __init__(self) -> None:
        self.flows: list[flow.Flow] = []
        self.filt: flowfilter.TFilter | None = None

    # meins
        self.save_path = "/home/user/Downloads/testhttpdump.har"
        # Dynamisch ctx.options.hardump überschreiben
        ctx.options.hardump = self.save_path

    @command.command("save.har")
    def export_har(self, flows: Sequence[flow.Flow], path: types.Path) -> None:
        """Export flows to an HAR (HTTP Archive) file."""
        print("IPC_Starting HAR export...", flush=True) # meins

        har = json.dumps(self.make_har(flows), indent=4).encode()

        if PROXY_DEBUG: print("IPC_IN_HAR_EXPORT_PROCESS", flush=True)

        if path.endswith(".zhar"):
            har = zlib.compress(har, 9)

        with open(path, "wb") as f:
            f.write(har)

        # wird immer geprintet, not sure
        if PROXY_DEBUG: print(f"IPC_Flows count after export: {len(self.flows)}", flush=True)


        # logging.log(ALERT, f"HAR file saved ({human.pretty_size(len(har))} bytes).")

        # Clear flows after export
        self.flows = []
        if PROXY_DEBUG: print(f"IPC_Flows cleared after export: {len(self.flows)}", flush=True)



    def request(self, flow: http.HTTPFlow) -> None:
        # """Handle shutdown request via HTTP"""
        # if flow.request.pretty_url == "http://shutdown.proxy.local/":
        #     print("PROXY_SHUTDOWN_REQUESTED_HTTP", flush=True)
        #     ctx.master.shutdown()

        """Handle shutdown request via HTTP"""
        if flow.request.pretty_url == "http://harddump.proxy.local/":
            print("IPC_PROXY_HARDUMP_REQUESTED_HTTP", flush=True)
            # call export_har
            #ctx.options.hardump = "-"
            if PROXY_DEBUG: print(f"IPC_Current flows count: {len(self.flows)}", flush=True)

            #self._save_flow(flow) todo vielleicht ist das doch nötig für full har export
            #print(f"IPC_Flows count after save: {len(self.flows)}", flush=True)

            try:
                self.export_har(self.flows, self.save_path)
                
                # Send success response
                # flow.response = http.Response.make(
                #     200,  # Status code
                #     b"HAR exported successfully",  
                #     {"Content-Type": "text/plain"} 
                # )
            except Exception as e:
                print(f"IPC_Error during HAR export: {str(e)}", flush=True)
                #logger.error(f"HAR export failed: {str(e)}", exc_info=True)


        # TODO: test ob die http response funktioniert oder ipc antwort besser ist
        """Send a reply from the proxy without sending the request to the remote server."""
        # https://docs.mitmproxy.org/stable/addons-examples/#http-reply-from-proxy
        if flow.request.pretty_url == "http://hardumppath.proxy.local/":
            # Get the HAR path from the request header
            har_path = flow.request.headers.get('X-Har-Path', '')
            if har_path:
                self.save_path = har_path
                ctx.options.hardump = self.save_path

                # Debug check and clear HAR flows
                #print(f"IPC_Flows count before clear: {len(self.flows)}", flush=True)
                #self.flows = []
                #print(f"IPC_Flows count after clear: {len(self.flows)}", flush=True)

                # Kill the connection to prevent further DNS lookup
                # flow.kill()
                print(f"IPC_HAR_PATH_SET: {har_path}", flush=True)
        
        # Clear HAR flows TODO doch in hardumppath eingebaut
        if flow.request.pretty_url == "http://clearflows.proxy.local/":
            if PROXY_DEBUG: print("IPC_CLEAR_FLOWS_REQUESTED_HTTP", flush=True)
            if PROXY_DEBUG: print(f"IPC_Flows count before clear: {len(self.flows)}", flush=True)
            self.flows = []
            if PROXY_DEBUG: print(f"IPC_Flows count after clear: {len(self.flows)}", flush=True)

        if flow.request.pretty_url == "http://getharflows.proxy.local/":
            if PROXY_DEBUG: print(f"IPC_GET_HAR_FLOWS_REQUESTED_HTTP: {len(self.flows)}", flush=True)
            #flow.kill()
            # No IPC console response if response is made
            #flow.response = http.Response.make(
            #    200,  # Status code
            #    b"getharflows was successful",  
            #    {"Content-Type": "text/plain"} 
            #)
            # Kill the connection to prevent further DNS lookup
            #flow.kill()



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

        return {
            "log": {
                "version": "1.2",
                "creator": {
                    "name": "mitmproxy",
                    "version": version.VERSION,
                    "comment": "",
                },
                "pages": [],
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
        print("PROXY_LOADED", flush=True)# meins

    def running(self): # meins
        """Called when the proxy is fully started"""
        print("IPC_PROXY_READY", flush=True)  # Signal to Node.js that proxy is ready

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
            if not ctx.options.hardump:
                self.flows = [] # meins
                print("IPC_Hier wurden flows gelöscht", flush=True) # debug

    def response(self, flow: http.HTTPFlow) -> None:
        # websocket flows will receive a websocket_end,
        # we don't want to persist them here already
        if flow.websocket is None:
            self._save_flow(flow)

    def error(self, flow: http.HTTPFlow) -> None:
        self.response(flow)

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        self._save_flow(flow)

    def _save_flow(self, flow: http.HTTPFlow) -> None:
        # Skip requests to *.proxy.local domains which are used for HTTP control
        if ".proxy.local" in flow.request.pretty_url:
            return
        #if ctx.options.hardump:
        flow_matches = self.filt is None or self.filt(flow)
        if flow_matches:
            self.flows.append(flow)

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
