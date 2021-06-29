ARG NODE_IMAGE
FROM node:${NODE_IMAGE} AS builder
RUN apk add \
    git \
    make
RUN mkdir /workdir
WORKDIR /workdir
ENTRYPOINT ["/bin/sh", "-c"]

FROM node:${NODE_IMAGE} AS runtime
ARG PACKAGE_NAME
COPY ${PACKAGE_NAME} /tmp/${PACKAGE_NAME}
RUN yarn add --production --frozen-lockfile /tmp/${PACKAGE_NAME} && \
    rm /tmp/${PACKAGE_NAME}
ENV NODE_ENV=production
ENV NODE_ARGS=--no-deprecation

USER nobody
EXPOSE 8080
EXPOSE 8081
ENTRYPOINT ["/node_modules/exposr-server/exposr-server"]