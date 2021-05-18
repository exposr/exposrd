# exposr

exposr is a self-hosted tunnel server that allows you to securley expose devices and services
behind NATs or firewalls to the Internet through public URLs.

Exposr can for example be used for development and previews or for exposing services behind NAT/firewalls
to the Internet without port-forwarding and risk of exposing your IP address.

exposr-service is the server component and is designed to run as a container, scales
horizontally with persistance support through Redis.