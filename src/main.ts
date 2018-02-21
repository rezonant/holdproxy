require('source-map-support').install();
import * as express from 'express';
import { request as httpRequest } from 'http';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { Subscription } from 'rxjs/Subscription';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

let configFile = process.argv[2] || '/etc/holdproxy.yaml';
let configSpecified = process.argv[2] ? true : false;
let port = 7777;
let upstream = "localhost:3000";
let maxAttempts = 10;
let delay = 5;

function configure() {
    try {
        let configDoc = yaml.load(fs.readFileSync(configFile, 'utf8'));

        if (!configDoc.holdproxy)
            throw new Error("Top level object must be 'holdproxy'");

        port = configDoc.holdproxy.port || port;
        upstream = configDoc.holdproxy.upstream ? configDoc.holdproxy.upstream+"" : upstream; 
        maxAttempts = configDoc.holdproxy.maxAttempts || maxAttempts;
        delay = configDoc.holdproxy.delay || delay;
    } catch (e) {

        if (e['code'] == 'ENOENT') {
            if (configSpecified) {
                console.error(configFile+': Configuration file not found');
                process.exit(1);
            }
            return;
        }

        console.error('Invalid configuration:');
        console.error(e.message);
        process.exit(1);
    }
}

configure();

let upstreamPort : number;
let upstreamHost : string;

if (upstream.indexOf(':') > 0) {
    let [ host, port ] = upstream.split(/:/g, 2);
    upstreamHost = host;
    upstreamPort = parseInt(port);
} else if (/\d+/.test(upstream)) {
    upstreamPort = parseInt(upstream);
    upstreamHost = "localhost";
} else {
    upstreamHost = upstream;
    upstreamPort = 80;
}

let app = express()
    .all('/*', (req, res) => {
        let headers = {};

        for (let i = 0, max = req.rawHeaders.length; i < max; i += 2) {
            let key = req.rawHeaders[i];
            let value = req.rawHeaders[i + 1];
            headers[key] = value;
        }

        let params = {
            hostname: upstreamHost,
            port: upstreamPort,

            headers,
            path: req.path,
            method: req.method
        };

        // ---- 

        let requestBuffer = new ReplaySubject();
        req.on('data', chunk => requestBuffer.next(chunk));
        req.on('end', () => requestBuffer.next(null));

        // ----

        function doSubrequest(params, maxAttempts = 10, delay = 10, attempt = 1) {
            let invalid = false;

            let subrequest = httpRequest(params, (subresponse) => {
                for (let i = 0, max = subresponse.rawHeaders.length; i < max; i += 2) {
                    res.header(subresponse.rawHeaders[i], subresponse.rawHeaders[i+1]);
                }

                res.header('X-HoldProxy', `Attempt ${attempt}`);
    
                subresponse.on('data', chunk => res.write(chunk));
                subresponse.on('end', () => {
                    res.end();

                    if (attempt > 1) {
                        console.log(`${new Date()} | ${req.ip} | ${req.method} ${req.path} | ${subresponse.statusCode} | Recovered after ${attempt} attempts`);
                    } else {
                        console.log(`${new Date()} | ${req.ip} | ${req.method} ${req.path} | ${subresponse.statusCode}`);
                    }
                });
            });

            subrequest.on('error', e => {
                if (e['code'] == 'ECONNREFUSED') {

                    invalid = true;

                    if (attempt < maxAttempts) {
                        console.log(`${new Date()} | ${req.ip} | ${req.method} ${req.path} | upstream down, held for retry in ${delay} seconds`);
                        setTimeout(() => {
                            doSubrequest(params, maxAttempts, delay, attempt + 1);
                        }, 1000 * delay);
            
                        return;
                    }

                    console.log(`${new Date()} | ${req.ip} | ${req.method} ${req.path} | still down after maximum (${maxAttempts}) attempts`);

                    console.log('Failed to connect to upstream!');
                    console.log(e);

                    res.status(503);
                    res.header('X-HoldProxy', `Failed after ${maxAttempts} attempts`);
                    res.header('Content-Type', 'text/html');
                    res.write("<html><body>holdproxy 503: Service unavailable</body></html>");
                    res.end();

                    console.log(`${new Date()} | ${req.ip} | ${req.method} ${req.path} | 503`);

                } else {
                    console.log('Error during request:');
                    console.log(e);
                    res.status(500);
                    res.header('Content-Type', 'text/html');
                    res.write("<html><body>holdproxy 500</body></html>");
                    res.end();
                }
            })

            !function() {
                var subscription : Subscription;
                subscription = requestBuffer.subscribe(chunk => {
                    if (invalid) {
                        subscription.unsubscribe();
                        return;
                    }

                    if (chunk) {
                        subrequest.write(chunk)
                    } else {
                        subrequest.end();
                        if (subscription != null)
                            subscription.unsubscribe();
                        invalid = true;
                    }
                });

                if (invalid)
                    subscription.unsubscribe();
            }();
        }

        doSubrequest(params, maxAttempts, delay);

    })
    .listen(port, () => {
        console.log();
        console.log(`holdproxy: listening on port ${port}, sending to upstream ${upstreamHost}:${upstreamPort}`);
        console.log(` - max attempts: ${maxAttempts}`);
        console.log(` - retry delay: ${delay}`);
        console.log();

    });