ARG NODE_IMAGE
FROM node:${NODE_IMAGE} AS builder
RUN apk add \
    git \
    make
RUN mkdir /workdir
WORKDIR /workdir
ENTRYPOINT ["/bin/sh", "-c"]


FROM node:${NODE_IMAGE} as platform
ARG TARGETPLATFORM
COPY dist /dist
RUN if [ "${TARGETPLATFORM}" = "linux/amd64" ]; then cp /dist/exposr-server-*-linux-x64 /exposr-server; fi
RUN if [ "${TARGETPLATFORM}" = "linux/arm64" ]; then cp /dist/exposr-server-*-linux-arm64 /exposr-server; fi
RUN if [ "${TARGETPLATFORM}" = "linux/arm/v7" ]; then cp /dist/exposr-server-*-linux-armv7 /exposr-server; fi

FROM scratch
ARG VERSION
LABEL org.opencontainers.image.description exposr-server ${VERSION}
COPY --from=platform /exposr-server /exposr-server
EXPOSE 8080
EXPOSE 8081
ENTRYPOINT ["/exposr-server"]