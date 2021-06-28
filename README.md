# exposr

exposr is a self-hosted tunnel server that allows you to securely expose devices and services
behind NATs or firewalls to the Internet through public URLs.

exposr can for example be used for development and previews or for exposing services behind NAT/firewalls
to the Internet without port-forwarding and risk of exposing your IP address.

Why another "localhost reverse proxy"? exposr takes a slightly different approach than other servers
of the same type. exposr is designed to run as a container with horizontal elastic scaling properties,
and is well suited to run in container-orchestration systems like Kubernetes.

## Features

* Scales horizontally - more nodes can be added to increase capacity.
* No configuration files! - All configuration can be done as environment variables or command line options.
* Designed to run behind a load balancer (HTTP/TCP) (ex. nginx or HAProxy) - only one port required to be exposed.
* Suitable to run in container-orchestration systems such as Kubernetes.
* Client does not need root privileges and can establish tunnels as long as it can make outbound HTTP(s) connections.
* Client can forward traffic to any host - not just localhost!
* Tunnel configuration through restful APIs.
* No passwords or e-mails - but still secure. An account number together with the tunnel identifier serves as credentials.

What it does *not* do
* Certificate provisioning.
* DNS provisioning.

This is on purpose as the server is designed to be stateless and to have elastic scaling
properties. Meaning these are more suitable to handle in other parts of the deployment stack, for
example at the load balancer. 

# Architecture
exposr have three core concepts, transports, endpoints and ingress.

A tunnel is composed of a transport and an endpoint.
The endpoint is used by the client to establish a tunnel connection.
The transport of the tunnel is the underlying data stream of the tunnel, it supports
multiple independent streams over one connection.

The ingress is for traffic destined for the tunnel target, an ingress supports one
specific protocol and have a distinct way of identifying which tunnel the request
is bound for.

```
                          +-----------------------+
      +----------------+  |  +-----------------+  |
----->|    Ingress     +--|->|    Transport    +--|-----------+
      +----------------+  |  +-----------------+  |           v
                          |                       |   +----------------+     +--------------+
                          |        Tunnel         |   |    Client      +---->|    Target    |
                          |                       |   +-------+--------+     +--------------+
                          |  +-----------------+  |           |
                          |  |    Endpoint     |<-|-----------+
                          |  +-----------------+  |           |
                          +-----------------------+           |
                             +-----------------+              |
                             |      API        |<-------------+
                             +-----------------+
```

**Supported transport**

| Type         | Method                                | Client support        |
| ------------ | ------------------------------------- | --------------------- |
| Websocket    | Custom multiplex websocket            | [`exposr-cli`](https://github.com/exposr/exposr-cli) | 

**Supported ingress types**

| Type         | Method                                | Protocol support      |
| ------------ | ------------------------------------- | --------------------- |
| HTTP         | Subdomain (wildcard domain)           | HTTP                  |

## Persistence
The default persistence mode is in-memory meaning all tunnel configurations are lost
when the server is restarted. Since tunnels (and accounts) are created by the client
on-the-fly this works good enough for small single-node setups.

Redis is supported for multi-node support or if long-term persistance is required.
## Horizontal scaling
exposr can be run in a clustered setup, ingress connections are re-routed to the node
that have the tunnel established. This allows load balancing in round-robin
fashion without need for sticky sessions.

Redis is required for clustered setup. No other configuration is needed, nodes
will auto-discover each other.

# Running exposr
## Quick start
You can quickly try out exposr without installing anything

Run the server, the server will listen on port 8080 and the API will be exposed at `http://host.docker.internal:8080`.
HTTP ingress sub-domains will be allocated from `http://localhost:8080`.

    docker run --rm -ti -p 8080:8080 exposr/exposr-server:latest --api-url http://host.docker.internal:8080 --allow-registration --http-ingress-domain http://localhost:8080

Start the client with, this will create a tunnel called `example` and connect it to `http://example.com`.
The tunnel will be available at `http://example.localhost:8080`.

    docker run --rm -ti exposr/exposr:latest --server http://host.docker.internal:8080/ tunnel http://example.com example

Try the tunnel

    curl --resolve example.localhost:8080:127.0.0.1 http://example.localhost:8080