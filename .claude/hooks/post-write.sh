#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

[[ -z "$FILE_PATH" ]] && exit 0

# --- Prettier (all supported file types) ---
if [[ "$FILE_PATH" =~ \.(ts|tsx|js|mjs|cjs|json|css|md)$ ]]; then
  cd "$CLAUDE_PROJECT_DIR" && pnpm exec prettier --write "$FILE_PATH" 2>/dev/null
fi

# --- ESLint + tsc (TypeScript files only, workspace-aware) ---
if [[ "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
  if [[ "$FILE_PATH" =~ /apps/frontend/ ]]; then
    WORKSPACE="$CLAUDE_PROJECT_DIR/apps/frontend"
  elif [[ "$FILE_PATH" =~ /apps/backend/ ]]; then
    WORKSPACE="$CLAUDE_PROJECT_DIR/apps/backend"
  elif [[ "$FILE_PATH" =~ /packages/database/ ]]; then
    WORKSPACE="$CLAUDE_PROJECT_DIR/packages/database"
  else
    exit 0
  fi

  # ESLint --fix (errors printed to stderr → visible to Claude)
  cd "$WORKSPACE" && pnpm exec eslint --fix "$FILE_PATH" 2>&1

  # tsc --noEmit (type errors visible to Claude; always exit 0 so it's advisory)
  cd "$WORKSPACE" && pnpm exec tsc --noEmit 2>&1 || true
fi

exit 0
