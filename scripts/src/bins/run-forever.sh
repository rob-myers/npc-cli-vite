#!/usr/bin/env bash

# This script:
# - restarts `pnpm ${PNPM_SCRIPT_NAME}` on crash
# - stops on exit e.g. ctrl-c
#
# Needed because we're using nodemon programmatically (not from CLI).

PNPM_SCRIPT_NAME=$1
COMMAND="pnpm run-forever ${PNPM_SCRIPT_NAME}"

while true; do
  pnpm "${PNPM_SCRIPT_NAME}"
  test $? -eq 0 && {
    echo -e "\033[33m[${COMMAND}]\033[97m exited gracefully $?" >&2
    break
  }
  echo -e "\033[33m[${COMMAND}]\033[97m crashed with exit code $?, respawning..." >&2
  sleep 1
done
