# Sweep Next Edit (VS Code)

Local next-edit prediction for VS Code powered by the **Sweep Next-Edit 1.5B** GGUF model via **llama.cpp** (through `node-llama-cpp`).

## What it does

- Watches your typing in the active editor.
- Runs the model to predict your next edit within a small window around the cursor.
- Shows a popup at the cursor containing only the text that would be inserted.
- Press `Tab` to accept the suggestion (applies the full window edit).

## Requirements

- Node.js + npm
- VS Code
- A local Sweep Next-Edit GGUF model file (not committed to this repo)

## Run (development)

```bash
npm install
npm test
```

In VS Code:

1. Open this folder.
2. Run and Debug → **Run Extension (clean)** → `F5`
3. In the Extension Development Host, set:
   - `sweepNextEdit.modelPath` → absolute path to `sweep-next-edit-1.5b.q8_0.v2.gguf`
4. Start typing; press `Tab` to accept the suggestion.

## Settings

- `sweepNextEdit.enabled`: enable/disable
- `sweepNextEdit.modelPath`: GGUF model path
- `sweepNextEdit.contextLines`: window size (lines above/below cursor)
- `sweepNextEdit.maxTokens`: generation cap (default `512`)
- `sweepNextEdit.triggerDebounceMs`: delay after typing before running inference
- `sweepNextEdit.contextFileCount` / `sweepNextEdit.contextFileMaxChars`: extra context from other open files

