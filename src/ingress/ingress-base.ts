export default abstract class IngressBase {

    public abstract getBaseUrl(tunnelId: string): URL;

    public abstract destroy(): Promise<void>;
}