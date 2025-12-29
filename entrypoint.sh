#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-/srv/app}"
DATA_DIR="${DATA_DIR:-/data}"

# Default tasks aus dem Repo (ins Image kopiert)
DEFAULT_TASKS="${DEFAULT_TASKS:-${APP_DIR}/data/tasks.json}"

# Ziel: persistente Datei im Volume
TARGET_TASKS="${DATA_DIR}/tasks.json"

# App erwartet (laut Logs) /config/tasks.json -> wir geben ihr einen Symlink
CONFIG_DIR="/config"
LINK_PATH="${TASKS_PATH:-/config/tasks.json}"

mkdir -p "${DATA_DIR}" "${CONFIG_DIR}"

# Falls jemand früher /config/tasks.json als Directory gemountet hat -> weg damit
if [ -d "${LINK_PATH}" ]; then
  rm -rf "${LINK_PATH}"
fi

# Falls im Volume aus Versehen ein Ordner tasks.json existiert -> weg damit
if [ -d "${TARGET_TASKS}" ]; then
  rm -rf "${TARGET_TASKS}"
fi

# Initialisierung: wenn /data/tasks.json noch nicht existiert, aus dem Image kopieren
if [ ! -f "${TARGET_TASKS}" ]; then
  if [ -f "${DEFAULT_TASKS}" ]; then
    cp "${DEFAULT_TASKS}" "${TARGET_TASKS}"
  else
    # Fallback: leere Liste, damit der Start nicht crasht
    echo "[]" > "${TARGET_TASKS}"
  fi
fi

# Symlink sicher setzen
if [ -e "${LINK_PATH}" ] || [ -L "${LINK_PATH}" ]; then
  rm -rf "${LINK_PATH}"
fi
ln -s "${TARGET_TASKS}" "${LINK_PATH}"

# Static-Verzeichnis absichern (dein aktueller Fehler)
if [ ! -d "${APP_DIR}/static" ]; then
  mkdir -p "${APP_DIR}/static"
fi

exec "$@"
