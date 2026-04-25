#!/bin/bash
set -e

echo "🚀 Triggering deploy via webhook..."

curl -X POST https://app.eventsyncapp.com/github-webhook

echo "✅ Deploy triggered"
