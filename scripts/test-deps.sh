#!/bin/bash

if [ $# -eq 0 ]; then
    echo "Need argument start or stop"
    exit -1
fi

cmd=$1

if [ "$cmd" == "start" ]; then
    docker compose -f deps/docker-compose.yaml up -d --wait
elif [ "$cmd" == "stop" ]; then
    docker compose -f deps/docker-compose.yaml down
else
    echo "Unknown command $cmd"
fi