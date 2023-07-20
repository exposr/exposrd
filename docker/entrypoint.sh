#!/bin/sh

for file in $(ls /entrypoint-initdb.d)
do
	./entrypoint-initdb.d/$file
done

exec node ${NODE_ARGS} exposrd.mjs $@