#!/bin/sh
# compose.game.yml starts the engine through this, as root, with the folder
# compose.yml was downloaded into mounted as the parent of GAME_DIR. It becomes
# that folder's owner before running anything, so what the engine writes into
# the game is the creator's to edit on the host, with no UID or GID to pass.
# A root-owned folder anyone may write to (Docker Desktop's view of a Windows
# drive) gets the image's own user instead; one only root may write to (a root
# shell on a server) stays root, who owns everything there anyway.
#
# With no arguments it runs the server, writing the starter game first while
# the game folder is missing or empty. With arguments it runs those instead,
# which is how the new-game service picks a name or --isometric.
set -e

project=$(dirname "$GAME_DIR")
# Recordings go beside the game: the engine's default is under /app, which the
# folder's owner cannot write and a new container would not keep.
export REPLAY_DIR="${REPLAY_DIR:-$project/replays}"
uid=$(stat -c %u "$project")
gid=$(stat -c %g "$project")
if [ "$uid" = 0 ] && [ "$(stat -c %A "$project" | cut -c9)" = w ]; then
  uid=$(id -u node)
  gid=$(id -g node)
fi
as=
[ "$uid" = 0 ] || as="setpriv --reuid=$uid --regid=$gid --clear-groups"

if [ $# -eq 0 ]; then
  if [ -z "$(ls -A "$GAME_DIR" 2>/dev/null)" ]; then
    $as node dist/server/contentPack/newGame.js "$GAME_DIR" "My Game"
  fi
  set -- node --enable-source-maps dist/server/server.js
fi
exec $as "$@"
