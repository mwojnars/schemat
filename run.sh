#!/bin/bash

# Get the directory of the current script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execute Schemat from the root folder of the source code
cd $SCRIPT_DIR
node --experimental-vm-modules "$SCRIPT_DIR/schemat/server/run.js" "$@"
