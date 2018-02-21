# Holdproxy

Just a simple Express-based proxy which can hold requests while your app server restarts. Put it between nginx and your real application server and `holdproxy` takes care of the rest.

**Note**: This is no substitute for proper high availability configuration (HA). In an HA scenario, you have multiple app servers, and you restart each one in sequence gracefully. Also, this should not be exposed to the web, it is purely intended to sit between a proper web-exposed proxy such as nginx and your application server. It is basically middleware with it's own port. 

## Configuration

To configure `holdproxy`, either run `holdproxy /path/to/config/file` or put your configuration in `/etc/holdproxy.yaml`. The configuration format is YAML.

```yaml
holdproxy:
    listen: 3001
    upstream: 3000
    delay: 5
    maxAttempts: 10
```

The `upstream` parameter can be a port number, a `host:port` specifier, or just a `host` (in which case port 80 is assumed).