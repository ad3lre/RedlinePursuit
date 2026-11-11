#!/usr/bin/env bash
# Build and publish to the static dir served at https://rxnd.de/chase/
set -e
cd "$(dirname "$0")"
node build.mjs
DEST=/home/founder/prod/chase/www
mkdir -p "$DEST" "$DEST/audio"
cp index.html game.js "$DEST/"
# MP3 beds stay outside the JS bundle (load by URL audio/<pool>/<id>.mp3)
rm -rf "$DEST/audio/echo" "$DEST/audio/playlist"
cp -r assets/audio/echo "$DEST/audio/echo"
cp -r assets/audio/playlist "$DEST/audio/playlist"
(sudo -n systemctl restart chase.service 2>/dev/null || systemctl restart chase.service 2>/dev/null || true)
echo "deployed -> $DEST"
