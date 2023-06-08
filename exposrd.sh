#!/usr/bin/env sh
cd `dirname "$0"`
exec /usr/bin/env node --experimental-json-modules --no-warnings --title="$0 $*" exposrd.js $@