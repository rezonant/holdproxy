

import * as express from 'express';
import { request as httpRequest } from 'http';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { Subscription } from 'rxjs/Subscription';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

export interface Config {
    port : number;
    upstreamHost : string;
    upstreamPort : number;
    maxAttempts : number;
    delay : number;

}

export class Holdproxy {
    constructor(
        private config : Config,
        private _app? : express.Application
    ) {
        if (!this._app)
            this._app = express();

        this._app.all('/*', (req, res) => this.handleRequest(req, res));
    }

    public get app() : express.Application {
        return this._app;
    }

    async listen(callback): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this._app
                .listen(this.config.port, () => callback())
                .on('error', err => {
                    reject(err);
                });
        });
    }

    logInfo(req : express.Request, message : string) {
        console.log(`${new Date()} | ${req.ip} | ${req.method} ${req.path} | ${message}`);
    }

    logError(req : express.Request, message : string) {
        console.error(`${new Date()} | ${req.ip} | ${req.method} ${req.path} | ${message}`);
    }

    handleRequest(req : express.Request, res : express.Response) {
        let headers = {};

        for (let i = 0, max = req.rawHeaders.length; i < max; i += 2) {
            let key = req.rawHeaders[i];
            let value = req.rawHeaders[i + 1];
            headers[key] = value;
        }

        let params = {
            hostname: this.config.upstreamHost,
            port: this.config.upstreamPort,

            headers,
            path: req.path,
            method: req.method
        };

        // ---- 

        let requestBuffer = new ReplaySubject();
        req.on('data', chunk => requestBuffer.next(chunk));
        req.on('end', () => requestBuffer.next(null));

        // ----

        let doSubrequest = (params, maxAttempts = 10, delay = 10, attempt = 1) => {
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
                        this.logInfo(req, `${subresponse.statusCode} | Recovered after ${attempt} attempts`);
                    } else {
                        this.logInfo(req, `${subresponse.statusCode}`);
                    }
                });
            });

            subrequest.on('error', e => {
                if (e['code'] == 'ECONNREFUSED') {

                    invalid = true;

                    if (attempt < maxAttempts) {
                        this.logInfo(req, `upstream down, held for retry in ${delay} seconds`);
                        setTimeout(() => {
                            doSubrequest(params, maxAttempts, delay, attempt + 1);
                        }, 1000 * delay);
            
                        return;
                    }

                    this.logInfo(req, `still down after maximum (${maxAttempts}) attempts`);

                    console.log('Failed to connect to upstream!');
                    console.log(e);

                    res.status(503);
                    res.header('X-HoldProxy', `Failed after ${maxAttempts} attempts`);
                    res.header('Content-Type', 'text/html');
                    res.write("<html><body>holdproxy 503: Service unavailable</body></html>");
                    res.end();

                    this.logError(req, `503 | service unavailable`);
                } else {
                    console.log('Error during request:');
                    console.log(e);
                    res.status(500);
                    res.header('Content-Type', 'text/html');
                    res.write("<html><body>holdproxy 500</body></html>");
                    res.end();

                    this.logError(req, `500 | ${e.message} | ${e.stack}`);
                }
            })

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
        }

        doSubrequest(params, this.config.maxAttempts, this.config.delay);
    }
}