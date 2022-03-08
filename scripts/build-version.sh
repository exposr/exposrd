#!/bin/sh
SCRIPTS=$(dirname "$0")
ROOT=${SCRIPTS}/..
${SCRIPTS}/gen-build-env.sh > ${ROOT}/build.env
source ${ROOT}/build.env
export EXPOSR_BUILD_VERSION
export EXPOSR_BUILD_GIT_BRANCH
export EXPOSR_BUILD_GIT_COMMIT
export EXPOSR_BUILD_DATE
export EXPOSR_BUILD_USER
export EXPOSR_BUILD_MACHINE
${SCRIPTS}/gen-build-js.sh > ${ROOT}/build.js
git update-index --assume-unchanged ${ROOT}/build.js
echo version: ${EXPOSR_BUILD_VERSION}