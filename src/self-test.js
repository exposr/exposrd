import dns from 'dns';
import net from 'net';
import fs from 'fs';
import sqlite3 from 'better-sqlite3';

async function selfTest() {
    const tests = [
      { name: 'DNS lookup', testFn: testDNSLookup },
      { name: 'HTTPS connection', testFn: testHTTPSConnection },
      { name: 'SQLite3 module', testFn: testSQLiteModule }
    ];

    let allTestsPassed = true;

    for (const test of tests) {
        const testResult = await test.testFn();
        console.log(`${test.name} test: ${testResult ? 'PASS' : 'FAIL'}`);
        allTestsPassed = allTestsPassed && testResult;
    }

    return allTestsPassed;
}

function testDNSLookup() {
    return new Promise((resolve) => {
        dns.lookup('example.com', (error) => {
            if (error) {
                console.log('DNS error', error);
            }
            resolve(!error);
        });
    });
}

function testHTTPSConnection() {
    return new Promise((resolve) => {
        const socket = net.connect(443, 'cloudflare.com', () => {
            socket.end();
            resolve(true);
        });

        socket.on('error', (error) => {
            console.log('HTTPS error', error);
            resolve(false);
        });
    });
}

function testSQLiteModule() {
    const databaseName = 'self-test.db';

    let result;
    try {
        const db = new sqlite3(databaseName);
        db.close();
        result = true;
    } catch (error) {
        console.log('SQlite error:', error);
        result = false;
    } finally {
        fs.rmSync(databaseName);
    }
    return result;
}

export default selfTest;