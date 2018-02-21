require('source-map-support').install();

import * as express from 'express';
import { request as httpRequest } from 'http';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { Subscription } from 'rxjs/Subscription';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import { Config, Holdproxy } from './holdproxy';

/** 
 * Additional config options and shortcuts which are only available 
 * through the CLI
 */
interface CliConfig extends Config {
    upstream? : string | number;
}

export const DEFAULT_CONFIG = {
    port: 3001,
    upstream: 3000, 
    maxAttempts: 10,
    delay: 5,
    upstreamHost: 'localhost',
    upstreamPort: 3000
};

class HoldproxyCommand {
    /**
     * Main function of the holdproxy command.
     * @param args 
     */
    public static async main(args : string[]) {
        let configFile = args[0] || '/etc/holdproxy.yaml';
        let configSpecified = args[0] ? true : false;
        let config = this.getConfig(configFile, configSpecified);

        try {
            await new Holdproxy(config).listen(() => {
                console.log();
                console.log(`holdproxy listening on port ${config.port}`)
                console.log(` - configured from: ${configFile}`)
                console.log(` - upstream: ${config.upstreamHost}:${config.upstreamPort}`);
                console.log(` - max attempts: ${config.maxAttempts}`);
                console.log(` - retry delay: ${config.delay}`);
                console.log();
            });
        } catch (e) {
            if (e['code'] == 'EADDRINUSE')
                this.bail(`Error: The port ${config.port} is already in use.`);

            console.error("Unhandled error:");
            console.error(e);

            this.bail(e.message);
        }
    }

    private static bail(message : string, exitCode = 1) {
        console.error(message);
        process.exit(exitCode);
    }

    private static getConfig(configFile : string, required = false): CliConfig {
        let config : CliConfig = null;
        let rawConfig = {};

        try {
            let parsedConfig = yaml.load(fs.readFileSync(configFile, 'utf8'));
            if (parsedConfig.holdproxy)
                rawConfig = this.processConfig(parsedConfig.holdproxy);
        } catch (e) {
            if (e['code'] == 'ENOENT') {
                if (required)
                    this.bail(`${configFile}: Configuration file not found`);
            } else {
                this.bail(`Invalid configuration: ${e.message}`);
            }
        }

        return Object.assign(DEFAULT_CONFIG, rawConfig);
    }

    private static processConfig(parsedConfig : CliConfig) {
        if (parsedConfig.upstream) {
            let upstreamHost;
            let upstreamPort;
            if (typeof parsedConfig.upstream === 'number') {
                upstreamHost = 'localhost';
                upstreamPort = parsedConfig.upstream;
            } else if (parsedConfig.upstream.indexOf(':') > 0) {
                let [ host, port ] = parsedConfig.upstream.split(/:/g, 2);
                upstreamHost = host;
                upstreamPort = parseInt(port);
            } else if (/\d+/.test(parsedConfig.upstream)) {
                upstreamPort = parseInt(parsedConfig.upstream);
                upstreamHost = "localhost";
            } else {
                upstreamHost = parsedConfig.upstream;
                upstreamPort = 80;
            }

            parsedConfig.upstreamHost = upstreamHost;
            parsedConfig.upstreamPort = upstreamPort;
        }

        return parsedConfig;
    }
}

HoldproxyCommand.main(process.argv.splice(2));
