#!/bin/bash

# Get the directory of the current script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR=$SCRIPT_DIR/../..

# Execute Schemat from the root folder of the source code
cd $ROOT_DIR
node --experimental-vm-modules "$ROOT_DIR/schemat/server/run.js" --config ./demo/01_books/config.yaml "$@"
