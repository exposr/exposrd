class IngressUtils {
    static getTunnelId(hostname: string | undefined, wildcardHost?: string): string | undefined {
        if (hostname === undefined) {
            return undefined;
        }

        const host = hostname.toLowerCase().split(":")[0];
        if (host === undefined) {
            return undefined;
        }

        const tunnelId = host.split('.', 1)[0];
        const parentDomain = host.slice(tunnelId.length + 1);
        if (wildcardHost) {
            if (wildcardHost.startsWith('*.')) {
                wildcardHost = wildcardHost.slice(2);
            }
            if (parentDomain != wildcardHost) {
                return undefined;
            }
        }
        return tunnelId;
    }
}

export default IngressUtils;