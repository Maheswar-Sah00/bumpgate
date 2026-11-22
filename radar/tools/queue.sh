#!/bin/sh
# run.mjs on each id in turn: sh queue.sh <port> <id> [<id> ...]
cd "$(dirname "$0")"
port=$1; shift
for id in "$@"; do
  echo "start $id $(date +%H:%M)"
  RADAR_PORT=$port node run.mjs "$id" > "results-$id.log" 2>&1
  echo "done $id exit=$? $(date +%H:%M) $(tr '\r' '\n' < results-$id.log | grep -E '^(init|check):' | tr '\n' ' ')"
done
echo QUEUE-DONE
