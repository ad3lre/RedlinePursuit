#!/usr/bin/env bash
# Build and publish to the static dir served at https://rxnd.de/chase/
set -e
cd "$(dirname "$0")"
node build.mjs
DEST=/home/founder/prod/chase/www
mkdir -p "$DEST"
cp index.html game.js "$DEST/"
echo "deployed -> $DEST"
