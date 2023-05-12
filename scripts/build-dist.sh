#!/bin/sh
SCRIPTS=$(dirname "$0")
ROOT=${SCRIPTS}/..

platform=$1
targets=$2

env="${ROOT}/build.env"
if [ ! -f "${env}" ]; then
    yarn run version
    cleanup=1
fi

. ${env}

yarn run pkg \
    --options 'no-warnings' \
    --public-packages 'node_modules/*' \
    --config package.json \
    -o dist/exposr-server-${EXPOSR_BUILD_VERSION}-${platform} \
    -t ${targets} \
    exposr-server.cjs

if [ ! -z "${cleanup}" ]; then
    rm build.env
fi