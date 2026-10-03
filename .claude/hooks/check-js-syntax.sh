#!/bin/bash
# Hook PostToolUse (Edit/Write) : verifie la syntaxe JS du fichier modifie.
# But : attraper immediatement une erreur de syntaxe (parenthese, virgule,
# accolade oubliee...) avant meme un "git commit" ou un push Railway --
# exactement le genre d'erreur qui a deja plante server.js par le passe.

input=$(cat)
file_path=$(echo "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

# Ne rien faire si ce n'est pas un fichier .js
if [[ "$file_path" != *.js ]]; then
  exit 0
fi

if [[ ! -f "$file_path" ]]; then
  exit 0
fi

error_output=$(node --check "$file_path" 2>&1)
status=$?

if [[ $status -ne 0 ]]; then
  echo "❌ Erreur de syntaxe JS detectee dans $file_path :" >&2
  echo "$error_output" >&2
  # Exit 2 : signale un probleme bloquant a Claude Code (remonte comme erreur de hook)
  exit 2
fi

echo "✅ Syntaxe JS OK : $file_path"
exit 0
