ARG NODE_IMAGE
FROM node:${NODE_IMAGE} AS builder
RUN apt update && apt -y install build-essential git make
RUN mkdir -p /dist /workdir /.cache /.yarn /.npm /tmp
RUN chmod 777 /.cache /.yarn /.npm /tmp
WORKDIR /workdir
ENTRYPOINT ["/bin/sh", "-c"]

FROM builder AS distbuild
ARG NODE_VERSION
ARG TARGETPLATFORM
ARG VERSION=*
ARG DIST_SRC
COPY ${DIST_SRC} /exposr-server.tgz
RUN tar xvf /exposr-server.tgz
# Available dst targets at https://github.com/vercel/pkg-fetch
RUN cd package; \
    if [ "${TARGETPLATFORM}" = "linux/amd64" ]; then \
        export dist_platform=linux-glibc-amd64; \
        export dist_target=node${NODE_VERSION}-linux-x64; \
    elif [ "${TARGETPLATFORM}" = "linux/arm64" ]; then \
        export dist_platform=linux-glibc-arm64; \
        export dist_target=node${NODE_VERSION}-linux-arm64; \
    elif [ "${TARGETPLATFORM}" = "linux/arm/v7" ]; then \
        export dist_platform=linux-glibc-armv7; \
        export dist_target=node${NODE_VERSION}-linux-armv7; \
    fi; \
    make dist.linux.build; \
    cp dist/exposr-server-${VERSION}-${dist_platform} /dist; \
    mkdir -p /buildroot/lib; \
    cp dist/exposr-server-${VERSION}-${dist_platform} /buildroot/exposr-server
# Populate the builroot with required libraries
RUN objdump -x /buildroot/exposr-server | grep NEEDED | awk '{print $2}' | \
    xargs -I {} find /lib64 /lib /usr/lib \( -name {} -o -name libnss* -o -name libresolv* \) | \
    xargs -I {} sh -c 'mkdir -p "/buildroot/$(dirname "{}")" && cp -aL "{}" "/buildroot/{}"';
# Sanity check buildroot
RUN chroot /buildroot/ /exposr-server --version | grep ${VERSION}

FROM scratch AS imagebuild
ARG VERSION
LABEL org.opencontainers.image.description exposr-server ${VERSION}
COPY --from=distbuild /buildroot/ /
EXPOSE 8080
EXPOSE 8081
ENTRYPOINT ["/exposr-server"]