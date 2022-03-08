#!/bin/sh
echo EXPOSR_BUILD_VERSION=$(git describe --tags --always --dirty 2> /dev/null || git rev-parse --short HEAD)
echo EXPOSR_BUILD_GIT_BRANCH=$(git describe --all --always)
echo EXPOSR_BUILD_GIT_COMMIT=$(git rev-parse HEAD)
echo EXPOSR_BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo EXPOSR_BUILD_USER=$(id -u)
echo EXPOSR_BUILD_MACHINE=\"$(uname -a)\"