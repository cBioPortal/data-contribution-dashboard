#!/bin/sh
# Render the SPA's runtime configuration from the container environment.
#
# Vite freezes import.meta.env values into the bundle at build time, which would
# make each image environment-specific. Instead the bundle reads window.__ENV__
# (see src/config.ts) and this script rewrites that object on every start, so one
# published image can be promoted across dev/staging/prod via a ConfigMap.
#
# Dropped into /docker-entrypoint.d/, which the nginx base image runs on startup.
set -eu

CONFIG_FILE=/usr/share/nginx/html/config.js

# Values land inside a double-quoted JS string literal, so a stray " or \ would
# break the file. Escape both rather than emitting invalid JS.
escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cat > "$CONFIG_FILE" <<EOF
// Generated at container start by docker-entrypoint.sh — do not edit.
window.__ENV__ = {
  VITE_API_URL: "$(escape "${VITE_API_URL:-}")",
  VITE_KEYCLOAK_URL: "$(escape "${VITE_KEYCLOAK_URL:-}")",
  VITE_KEYCLOAK_REALM: "$(escape "${VITE_KEYCLOAK_REALM:-}")",
  VITE_KEYCLOAK_CLIENT_ID: "$(escape "${VITE_KEYCLOAK_CLIENT_ID:-}")"
};
EOF

echo "runtime config written to $CONFIG_FILE"
