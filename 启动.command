#!/bin/zsh
set -e

cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm is required. Install it from https://nodejs.org/"
  read -r
  exit 1
fi

npm start &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
sleep 1
open "http://127.0.0.1:4178/"
wait "$server_pid"
