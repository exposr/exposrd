#!/bin/bash

SCRIPTS=$(dirname "$0")
ROOT=${SCRIPTS}/..

if [ $# -eq 0 ]; then
    tests=test/unit
else
    tests="$@"
fi

system_tests=$(find $tests \( -path 'test/e2e*' -o -path 'test/system/*' \) | wc -l)
if [ -z $EXPOSR_TEST_DEPS_RUNNING ]; then
    if [ $system_tests -gt 0 ]; then
        ${SCRIPTS}/test-deps.sh start
    fi
fi

NODE_ENV=test mocha --exit --recursive $tests
ret=$?

if [ -z $EXPOSR_TEST_DEPS_RUNNING ]; then
    if [ $system_tests -gt 0 ]; then
        ${SCRIPTS}/test-deps.sh stop
    fi
fi

exit $ret