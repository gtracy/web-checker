#!/bin/bash
set -e

echo "Deploying Patagonia Scraper Infrastructure..."

# 1. Ensure depedencies
echo "Installing infra dependencies..."
cd infra
npm install

# 2. Deploy
echo "Running CDK Deploy..."
# We use --require-approval never to avoid blocking, but for first run user might want to see.
# But automation scripts generally should run.
npx cdk deploy --require-approval never

echo "Deployment Complete!"
