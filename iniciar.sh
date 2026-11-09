#!/usr/bin/env sh
# Rota do Edital — inicia o servidor local (macOS e Linux)
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 backend/server.py "$@"
elif command -v python >/dev/null 2>&1; then
  exec python backend/server.py "$@"
else
  echo "Python 3 não encontrado. Instale em https://www.python.org/downloads/"
  exit 1
fi
