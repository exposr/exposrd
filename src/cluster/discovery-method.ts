import dgram from 'dgram';

export default abstract class DiscoveryMethod {

    public abstract readonly name: string;

    public abstract eligible(): number;

    public abstract init(socket: dgram.Socket | undefined, socket6: dgram.Socket | undefined): void;

    public abstract getPeers(): Promise<Array<string>>;

}