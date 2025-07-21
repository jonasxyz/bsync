const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'crawl-data.sqlite');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the SQLite database.');
});

db.serialize(() => {
    console.log("\nTables in database:");
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
        if (err) {
            throw err;
        }
        console.log(tables.map(t => t.name));
    });

    console.log("\nFirst 5 rows of http_requests table:");
    const query = `SELECT visit_id, url, top_level_url, resource_type FROM http_requests LIMIT 5`;
    db.all(query, [], (err, rows) => {
        if (err) {
            throw err;
        }
        rows.forEach((row) => {
            console.log(row);
        });
    });
});

db.close((err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('\nClosed the database connection.');
}); 