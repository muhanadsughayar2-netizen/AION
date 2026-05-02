#!/bin/bash
# Post-merge setup for SnapToAI (Flask + Chrome extension).
# Idempotent: safe to run on every merge.
set -e

echo "[post-merge] python: $(python3 --version 2>&1)"

if [ -f requirements.txt ]; then
  echo "[post-merge] installing python deps from requirements.txt"
  python3 -m pip install --quiet --disable-pip-version-check -r requirements.txt
fi

# DB schema bootstrap is lazy (app.before_request -> ensure_db -> init_db),
# so no migration step is needed here. Workflow reconciliation runs after
# this script and will restart the Landing Page workflow automatically.

echo "[post-merge] done"
