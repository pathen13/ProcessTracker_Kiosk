#!/bin/sh
set -eu

TASKS_PATH="${TASKS_PATH:-/config/tasks.json}"
DB_PATH="${DB_PATH:-/data/tracker.db}"

# Verzeichnisse sicher anlegen
mkdir -p /data /config "$(dirname "$TASKS_PATH")" "$(dirname "$DB_PATH")"

# Rechte "robust" setzen (damit SQLite + App sicher schreiben können)
# (Falls chmod auf einem speziellen Volume/FS nicht erlaubt ist, ignorieren)
chmod 0777 /data /config 2>/dev/null || true

# tasks.json soll persistent unter /data liegen
if [ ! -f /data/tasks.json ]; then
  if [ -f /defaults/tasks.json ]; then
    cp /defaults/tasks.json /data/tasks.json
  else
    echo "[]" > /data/tasks.json
  fi
fi

# Dein Code erwartet (laut Stacktrace) /config/tasks.json.
# Wir machen daraus immer einen Symlink auf /data/tasks.json.
# Falls dort schon was "komisches" liegt, räumen wir auf.
if [ -e "$TASKS_PATH" ] && [ ! -L "$TASKS_PATH" ]; then
  rm -rf "$TASKS_PATH"
fi

if [ ! -e "$TASKS_PATH" ]; then
  ln -s /data/tasks.json "$TASKS_PATH"
fi

exec "$@"
