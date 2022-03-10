#!/bin/bash
#
# Example of how to use SSH as an exposr client, requires curl, jq, and ssh.
# Tunnel and account must be setup prior
#

EXPOSR_SERVER=${EXPOSR_SERVER:-http://localhost:8080}
EXPOSR_ACCOUNT=${EXPOSR_ACCOUNT:-AABBCCDDEEFF0001}
EXPOSR_TUNNEL=${EXPOSR_TUNNEL:-my-tunnel}
DESTINATION=${DESTINATION:-example.com:80}

loop=true
trap stopfn SIGINT
stopfn() {
    loop=false
    exit
}

get_token() {
    echo $(curl -s ${EXPOSR_SERVER}/v1/account/${EXPOSR_ACCOUNT}/token | jq -r .token)
}

# NB: THIS DOES NOT PERFORM ANY SANITY CHECKING ON THE URL, A MALICIOUS SERVER COULD INJECT COMMANDS
get_url() {
    token=$(get_token)
    echo $(curl -s -H "Authorization: Bearer ${token}" ${EXPOSR_SERVER}/v1/tunnel/${EXPOSR_TUNNEL} | jq -r .transport.ssh.url)
}

while ${loop}; do
    echo "Press Ctrl-C twice to disconnect"
    echo ""
    ssh -o "StrictHostKeyChecking no" -o "UserKnownHostsFile /dev/null" -R ${DESTINATION}:${DESTINATION} "$(get_url)"
    sleep 2
done