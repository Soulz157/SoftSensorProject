#!/bin/bash
FILE_PATH=$(cat | jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" =~ packages/database/src/generated/ ]]; then
  echo "Blocked: $FILE_PATH is auto-generated. Edit schema.prisma and run pnpm db:generate instead." >&2
  exit 2
fi

exit 0
