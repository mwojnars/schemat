#!/bin/bash

# Get the directory of the current script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR=$(realpath "$SCRIPT_DIR/../..")

# set NODE_PATH and the working directory to the root folder of the source code
export NODE_PATH=$ROOT_DIR
cd $ROOT_DIR

# here, the --loader <...> option is needed ONLY if the application wants to use non-relative import paths like `import from "schemat/..."`
node --experimental-vm-modules --loader esm-module-alias/loader "$ROOT_DIR/schemat/server/run.js" --node demo-01/node.1024 "$@"
