#!/bin/bash

# Script to count lines in all .js/jsx files in the project and sort either by line count or file path

# Check if an argument is provided
if [[ $1 == "sort-by-path" ]]; then
    # sort by path
    find . \( -name 'node_modules' -o -name 'assets' -o -name 'libs' \) -prune -o -type f \( -name '*.js' -o -name '*.jsx' \) -print | xargs wc -l | grep -v total | sort -k 2
else
    # sort by line count (default)
    find . \( -name 'node_modules' -o -name 'assets' -o -name 'libs' \) -prune -o -type f \( -name '*.js' -o -name '*.jsx' \) -print | xargs wc -l | sort -n
fi
