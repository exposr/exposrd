import assert from 'assert/strict';
import sinon from 'sinon';
import dgram from 'dgram';
import dns from 'dns';
import fs from 'fs';
import ClusterService from "../../../src/cluster/index.js";
import EventBus from "../../../src/cluster/eventbus.js";
import Config from "../../../src/config.js";
import UdpEventBus from '../../../src/cluster/udp-eventbus.js';
import MulticastDiscovery from '../../../src/cluster/multicast-discovery.js';
import KubernetesDiscovery from '../../../src/cluster/kubernetes-discovery.js';

describe('UDP eventbus', () => {

    const createClusterService = async (opts = {}) => {
        return new Promise((resolve, reject) => {
            const res = new ClusterService('udp', {
                ...opts,
                callback: (err) => { err ? reject(err) : resolve(res); }
            });
        });
    };

    describe('peer discovery method selection', () => {
        let config;

        beforeEach(() => {
            config = new Config();
        });

        afterEach(async () => {
            config.destroy();
        });

        it('selects multicast if no other is eligible', async () => {
            const bus = new UdpEventBus({});

            assert(bus._discoveryMethod instanceof MulticastDiscovery, "did not select multicast discovery method");
            await bus.destroy();
        });

        it('selects kubernetes if eligible', async () => {
            sinon.stub(fs, 'existsSync').withArgs('/var/run/secrets/kubernetes.io/serviceaccount/namespace').returns(true);
            const bus = new UdpEventBus({});

            assert(bus._discoveryMethod instanceof KubernetesDiscovery, "did not select kubernetes discovery method");
            await bus.destroy();
            sinon.restore();
        });

        it('selects multicast if forced', async () => {
            sinon.stub(fs, 'existsSync').withArgs('/var/run/secrets/kubernetes.io/serviceaccount/namespace').returns(true);
            const bus = new UdpEventBus({discoveryMethod: 'multicast'});

            assert(bus._discoveryMethod instanceof MulticastDiscovery, "did not select multicast discovery method");
            await bus.destroy();
            sinon.restore();
        });

        it('selects kubernetes if forced', async () => {
            sinon.stub(fs, 'existsSync').withArgs('/var/run/secrets/kubernetes.io/serviceaccount/namespace').returns(true);
            const bus = new UdpEventBus({discoveryMethod: 'kubernetes'});

            assert(bus._discoveryMethod instanceof KubernetesDiscovery, "did not select kubernetes discovery method");
            await bus.destroy();
            sinon.restore();
        });

        it('forced kubernetes fails if no serviceaccount file is present', async () => {
            sinon.stub(fs, 'existsSync').withArgs('/var/run/secrets/kubernetes.io/serviceaccount/namespace').returns(false);

            let exceptionThrown = false;
            try {
                const bus = new UdpEventBus({discoveryMethod: 'kubernetes'});
                await bus.destroy();
            } catch (e) {
                exceptionThrown = e;
            }

            assert(exceptionThrown?.message == "Selected peer discovery method kubernetes could not be used", `did not get expected exception, got ${exceptionThrown}`);
            sinon.restore();
        });
    });

    describe('with multicast peer discovery', () => {
        let config;

        beforeEach(() => {
            config = new Config();
        });

        afterEach(async () => {
            config.destroy();
            sinon.restore();
        });

        it('published messages are received', async () => {
            const membershipSpy = sinon.spy(dgram.Socket.prototype, 'addMembership');
            const clusterservice = await createClusterService({
                discoveryMethod: 'multicast'
            });

            assert(membershipSpy.calledWithExactly("239.0.0.1"), "group not set on socket");

            const bus = new EventBus();

            const waitmsg = new Promise((resolve) => {
                bus.once('foo', (msg) => {
                    resolve(msg);
                })
            });

            await bus.publish('foo', {data: 42});

            const recv = await waitmsg;
            assert(recv?.data == 42, "did not receive published message");

            await bus.destroy();
            await clusterservice.destroy();
        });

        it('invalid multicast message is rejected', async () => {
            const clusterservice = await createClusterService({
                discoveryMethod: 'multicast'
            });
            const bus = new EventBus();

            const spy = sinon.spy(ClusterService.prototype, "_receive");
            const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            sock.send("foo", 1025, '239.0.0.1');

            assert(spy.notCalled, "invalid message was delivered")
            sock.close();

            await bus.destroy();
            await clusterservice.destroy();
        });

        it('multicast group can be configured', async () => {
            const membershipSpy = sinon.spy(dgram.Socket.prototype, 'addMembership');
            const loopbackSpy = sinon.spy(dgram.Socket.prototype, 'setMulticastLoopback');

            const clusterservice = await createClusterService({
                discoveryMethod: 'multicast',
                multicast: {
                    group: '239.0.0.2'
                },
            });

            assert(clusterservice._bus._discoveryMethod._multicastgroup == '239.0.0.2', "group not set to 239.0.0.2");
            assert(membershipSpy.calledWithExactly("239.0.0.2"), "group not set on socket");
            assert(loopbackSpy.calledWithExactly(true), "multicast loopback not set");

            const bus = new EventBus();
            const waitmsg = new Promise((resolve) => {
                bus.once('foo', (msg) => {
                    resolve(msg);
                })
            });

            await bus.publish('foo', {data: 42});

            const recv = await waitmsg;
            assert(recv?.data == 42, "did not receive published message");

            await bus.destroy();
            await clusterservice.destroy();
        });

        it('invalid multicast group can not be configured', async () => {
            let error;
            try {
                const clusterservice = await createClusterService({
                    discoveryMethod: 'multicast',
                    multicast: {
                        group: '127.0.0.1'
                    },
                });
                error = false;
            } catch (e) {
                error = e;
            }

            assert(error?.message == '127.0.0.1 is not within the private multicast range 239.0.0.0/8', `did not get expected error, got ${error}`);
        });
    });

    describe('with kubernetes peer discovery', () => {
        let config;
        let bus;

        beforeEach(() => {
            config = new Config();
            sinon.stub(fs, 'existsSync').withArgs('/var/run/secrets/kubernetes.io/serviceaccount/namespace').returns(true);
        });

        afterEach(async () => {
            config.destroy();
            sinon.restore();
        });

        it(`published messages are received`, async () => {
            const clusterservice = await createClusterService({
                discoveryMethod: 'kubernetes'
            });
            bus = new EventBus();
            sinon.stub(dns, 'resolve4')
                .withArgs('exposr-headless.default.svc.cluster.local')
                .callsFake((host, callback) => {
                    callback(null, ['127.0.0.1']);
                });

            const waitmsg = new Promise((resolve) => {
                bus.once('foo', (msg) => {
                    resolve(msg);
                })
            });

            await bus.publish('foo', {data: 42});

            const recv = await waitmsg;
            assert(recv?.data == 42, "did not receive published message");

            await bus.destroy();
            await clusterservice.destroy();
        });

        it(`headless service name can be controlled with SERVICE_NAME and POD_NAMESPACE`, async () => {
            sinon.stub(process, 'env').value({
                ...process.env,
                'POD_NAMESPACE': 'my-space',
                'SERVICE_NAME': 'my-service'
            });

            const clusterservice = new ClusterService('udp', {
                discoveryMethod: 'kubernetes'
            });

            const serviceHost = clusterservice._bus._discoveryMethod._serviceHost;
            assert(serviceHost == 'my-service.my-space.svc.cluster.local', `did not get expected service host, got ${serviceHost}`);

            await clusterservice.destroy();
        });

        it(`headless service name can be controlled with custom environment names`, async () => {
            sinon.stub(process, 'env').value({
                ...process.env,
                'MY_POD_NAMESPACE': 'my-space',
                'MY_SERVICE_NAME': 'my-service'
            });

            const clusterservice = new ClusterService('udp', {
                discoveryMethod: 'kubernetes',
                kubernetes: {
                    serviceNameEnv: 'MY_SERVICE_NAME',
                    namespaceEnv: 'MY_POD_NAMESPACE',
                }
            });

            const serviceHost = clusterservice._bus._discoveryMethod._serviceHost;
            assert(serviceHost == 'my-service.my-space.svc.cluster.local', `did not get expected service host, got ${serviceHost}`);

            await clusterservice.destroy();
        });

        it(`headless service name can be set explicitly`, async () => {
            const clusterservice = await createClusterService({
                discoveryMethod: 'kubernetes',
                kubernetes: {
                    serviceName: 'my-service',
                    namespace: 'my-space',
                }
            });

            const serviceHost = clusterservice._bus._discoveryMethod._serviceHost;
            assert(serviceHost == 'my-service.my-space.svc.cluster.local', `did not get expected service host, got ${serviceHost}`);

            await clusterservice.destroy();
        });

        it(`getPeers is cached`, async () => {
            const clusterservice = await createClusterService({
                discoveryMethod: 'kubernetes'
            });

            sinon.stub(dns, 'resolve4')
                .withArgs('exposr-headless.default.svc.cluster.local')
                .callsFake((host, callback) => {
                    callback(null, ['127.0.0.1']);
                });

            const peers = await clusterservice._bus._discoveryMethod.getPeers();
            assert(peers[0] == "127.0.0.1", "did not get expected peer");

            sinon.restore();
            sinon.stub(dns, 'resolve4')
                .withArgs('exposr-headless.default.svc.cluster.local')
                .callsFake((host, callback) => {
                    callback(null, ['127.0.0.2']);
                });

            const peers2 = await clusterservice._bus._discoveryMethod.getPeers();
            assert(peers2[0] == "127.0.0.1", "did not get expected peer");

            const clock = sinon.useFakeTimers(Date.now() + 1000);
            const peers3 = await clusterservice._bus._discoveryMethod.getPeers();
            assert(peers3[0] == "127.0.0.2", "did not get expected peer");

            await clusterservice.destroy();
        });

    });

});