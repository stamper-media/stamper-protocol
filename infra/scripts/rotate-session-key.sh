#!/usr/bin/env bash
# Alias kept for the plan name (IMPLEMENTATION-PLAN WP-11): see foc-session-rotate.sh.
exec "$(dirname "${BASH_SOURCE[0]}")/foc-session-rotate.sh" "$@"
