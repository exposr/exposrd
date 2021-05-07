FROM node:15-alpine AS builder
RUN apk add git
COPY . /workdir
WORKDIR /workdir
RUN git clean -dffx
RUN yarn pack

FROM node:15-alpine
COPY --from=builder /workdir/exposr-server*.tgz /tmp
RUN yarn add /tmp/exposr-server*.tgz && \
    rm /tmp/exposr-server*.tgz

USER nobody
EXPOSE 8080
EXPOSE 8081
ENTRYPOINT ["/node_modules/exposr-server/exposr-server"]
