#!/bin/bash

# Get the directory of the current script
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execute Schemat from the root folder of the source code
cd $ROOT_DIR
node --experimental-vm-modules "$ROOT_DIR/schemat/server/run.js" "$@"
