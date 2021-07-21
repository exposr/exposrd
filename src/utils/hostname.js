import portNumbers from 'port-numbers';

class Hostname {
    static parse(host, port = undefined) {
        let url;

        if (!/:\/\//.test(host)) {
            host = `tcp://${host}`;
        }

        if (port) {
            host += `:${port}`;
        }

        try {
            url = new URL(host);
        } catch (e) {
            return undefined;
        }

        port = !url.port ? undefined : url.port;
        let protocol = url.protocol.slice(0, -1);

        let portInfo = portNumbers.getPort(protocol);
        const serviceInfo = portNumbers.getService(parseInt(url?.port || 0));
        if (portInfo == null) {
            if (serviceInfo != null) {
                protocol = serviceInfo.name;
                portInfo = portNumbers.getPort(protocol);
            }
        }
        if (!port && portInfo != null) {
            port = portInfo.port;
        }

        try {
            return new URL(`${protocol}://${url.hostname}:${port}`);
        } catch (e) {
            return url;
        }
    }

    static isTLS(url) {
        const tls = [
            'tcps',
            'tls',
            'https',
            'wss',
        ];

        return tls.includes(url.protocol.slice(0, -1));
    }

    static getPort(url) {
        const mapping = {
            'ws': 'http',
            'wss': 'https',
        };

        if (url.port != '') {
            return parseInt(url.port);
        }

        let protocol = url.protocol.slice(0, -1);
        protocol = mapping[protocol] ?? protocol;

        const portInfo = portNumbers.getPort(protocol);
        return portInfo ? portInfo.port : 0;
    }

}
export default Hostname;