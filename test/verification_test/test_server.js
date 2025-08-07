
const express = require('express');
const path = require('path');
const app = express();
//const port = 80; // Standard HTTP-Port - erfordert sudo auf Linux
const port = 3001; 

// Capability setzen (erlaube Port < 1024)
// sudo setcap cap_net_bind_service=+ep $(which node)

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- Test Pages ---

// 1. Simple static page
app.get('/static', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'static.html'));
});

// 2. Page with various resources
app.get('/resources', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'resources.html'));
});

// 3. Page with redirects
app.get('/redirect-source', (req, res) => {
    res.redirect(301, '/redirect-destination');
});

app.get('/redirect-destination', (req, res) => {
    res.send('Redirect successful!');
});

// 4. Pages with HTTP error codes
app.get('/not-found', (req, res) => {
    res.status(404).send('404 - Not Found');
});

app.get('/forbidden', (req, res) => {
    res.status(403).send('403 - Forbidden');
});

app.get('/server-error', (req, res) => {
    res.status(500).send('500 - Internal Server Error');
});

// --- Extended Test Pages ---

// 2xx Status Codes
app.get('/created', (req, res) => {
    res.status(201).send('201 - Created');
});

app.get('/no-content', (req, res) => {
    res.status(204).send();
});

// 3xx Status Codes
app.get('/redirect-found', (req, res) => {
    res.redirect(302, '/redirect-destination');
});

app.get('/not-modified', (req, res) => {
    res.status(304).send();
});

app.get('/temp-redirect', (req, res) => {
    res.redirect(307, '/redirect-destination');
});

// 4xx Status Codes
app.get('/bad-request', (req, res) => {
    res.status(400).send('400 - Bad Request');
});

app.get('/unauthorized', (req, res) => {
    res.status(401).send('401 - Unauthorized');
});

app.get('/method-not-allowed', (req, res) => {
    res.status(405).send('405 - Method Not Allowed');
});

app.get('/request-timeout', (req, res) => {
    res.status(408).send('408 - Request Timeout');
});

app.get('/gone', (req, res) => {
    res.status(410).send('410 - Gone');
});

app.get('/teapot', (req, res) => {
    res.status(418).send("418 - I'm a teapot");
});

app.get('/too-many-requests', (req, res) => {
    res.status(429).send('429 - Too Many Requests');
});

// 5xx Status Codes
app.get('/not-implemented', (req, res) => {
    res.status(501).send('501 - Not Implemented');
});

app.get('/bad-gateway', (req, res) => {
    res.status(502).send('502 - Bad Gateway');
});

app.get('/service-unavailable', (req, res) => {
    res.status(503).send('503 - Service Unavailable');
});

app.get('/gateway-timeout', (req, res) => {
    res.status(504).send('504 - Gateway Timeout');
});

// Special case: Slow response
app.get('/slow-response', (req, res) => {
    setTimeout(() => {
        res.send('This was a slow response.');
    }, 5000); // 5 seconds delay
});


// 5. Page with dynamic content (AJAX/Fetch)
app.get('/dynamic', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dynamic.html'));
});

app.get('/api/data', (req, res) => {
    res.json({ message: 'This is dynamic content!' });
});

// 6. WebSocket setup (using express-ws)
const expressWs = require('express-ws')(app);

app.get('/websocket', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'websocket.html'));
});

app.ws('/websocket-endpoint', (ws, req) => {
    ws.on('message', function(msg) {
        console.log('Received message from client:', msg);
        ws.send(`Server received: ${msg}`);
    });

    console.log('WebSocket client connected');
    ws.send('Welcome to the WebSocket test!');
});


// Cant run the server on localhost, because the proxy wont caputure these local flows
// Option 1: Only localhost (most restrictive)
// app.listen(port, 'localhost', () => {
//     console.log(`Test server listening at http://localhost:${port}`);
// });

// Option 2: 127.0.0.1 (IPv4 loopback only)
// app.listen(port, '127.0.0.1', () => {
//     console.log(`Test server listening at http://127.0.0.1:${port}`);
// });

// Option 3: All local interfaces (für Netzwerk-Zugriff)
app.listen(port, '0.0.0.0', () => {
    console.log(`Test server listening on all interfaces:`);
    console.log(`- Local: http://localhost:${port}`);
    console.log(`- Network: http://10.10.10.11:${port}`);
    console.log(`- Loopback: http://127.0.0.1:${port}`);
});

