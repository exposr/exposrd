#!/bin/bash

if [ $# -eq 0 ]; then
    tests=test/unit
else
    tests="$@"
fi

system_tests=$(find $tests -path 'test/system*' | wc -l)
if [ -z $EXPOSR_TEST_DEPS_RUNNING ]; then
    if [ $system_tests -gt 0 ]; then
        docker compose -f deps/docker-compose.yaml up -d --wait
    fi
fi

NODE_ENV=test mocha --exit --recursive $tests

if [ -z $EXPOSR_TEST_DEPS_RUNNING ]; then
    if [ $system_tests -gt 0 ]; then
        docker compose -f deps/docker-compose.yaml down
    fi
fi