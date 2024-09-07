#!/bin/bash

# Get the directory of the current script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR=$(realpath "$SCRIPT_DIR/../..")

# set NODE_PATH and the working directory to the root folder of the source code
export NODE_PATH=$ROOT_DIR
cd $ROOT_DIR
node --experimental-vm-modules "$ROOT_DIR/schemat/server/run.js" --config ./demo/01_books/config.yaml "$@"
