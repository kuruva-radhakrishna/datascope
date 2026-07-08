#!/bin/sh
set -e
node /app/backend/server.js &
exec nginx -g 'daemon off;'
