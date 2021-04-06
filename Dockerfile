FROM node:15-alpine AS builder
RUN apk add git
COPY . /workdir
WORKDIR /workdir
RUN git clean -dffx
RUN yarn pack

FROM node:15-alpine
COPY --from=builder /workdir/untitled-tunnel-project*.tgz /tmp
RUN yarn add /tmp/untitled-tunnel-project*.tgz && \
    rm /tmp/untitled-tunnel-project*.tgz

USER nobody
EXPOSE 8080
ENTRYPOINT ["node", "/node_modules/untitled-tunnel-project/server.js"]
