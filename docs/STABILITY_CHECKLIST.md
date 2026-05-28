# Stability Checklist

A comprehensive checklist to ensure the app is stable, reliable, and production-ready.

---

## 1. Build & Compilation

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] `npx vite build` succeeds with 0 errors
- [ ] `cargo tauri build` compiles with 0 errors and 0 warnings
- [ ] No unused imports or dead code warnings in Rust
- [ ] No TypeScript `any` type warnings

## 2. Core Chat Flow

- [ ] Send a message and receive a streamed response
- [ ] Streaming text appears word-by-word with blinking cursor
- [ ] Stop generation button works mid-stream
- [ ] Markdown renders correctly (headings, lists, tables, code blocks, links)
- [ ] Code blocks have syntax highlighting
- [ ] Copy button on messages works
- [ ] Message editing works (Save & Resend)
- [ ] Response regeneration (retry) works
- [ ] Cost/token counter updates after each message

## 3. Session Management

- [ ] New session starts cleanly (Ctrl+N)
- [ ] Session appears in sidebar history
- [ ] Restoring a past session loads all messages correctly
- [ ] Model indicator shows correct model after restore (not "unknown")
- [ ] Continuing a restored session appends to the SAME session (no splitting)
- [ ] Session title/preview is meaningful (not empty)
- [ ] Deleting a session removes it from sidebar
- [ ] Session persists after app restart

## 4. Model Selector

- [ ] Model dropdown opens/closes on click
- [ ] Models are grouped by provider (DeepSeek, Claude, OpenAI, OpenRouter, Nous)
- [ ] Switching models works and updates the indicator
- [ ] "Manage API Keys" button appears at top of dropdown
- [ ] Keyboard shortcut (Ctrl+Shift+M) toggles dropdown

## 5. API Key Management

- [ ] Modal opens from model dropdown
- [ ] All 6 providers listed (DeepSeek, Claude, OpenAI, OpenRouter, Nous, Tavily)
- [ ] Adding a key shows "Active" status with masked preview
- [ ] Updating a key works
- [ ] Removing a key works and clears status
- [ ] Keys persist after app restart (check `~/.claude/workspace-brain/keys/api_keys.json`)
- [ ] Password input field masks the key while typing
- [ ] Enter key submits, Escape cancels editing
- [ ] Keys are loaded into environment variables on startup

## 6. Project Switcher

- [ ] Project dropdown opens/closes
- [ ] "Browse folder..." opens file picker
- [ ] Selecting a project switches context
- [ ] Active project is highlighted with accent border
- [ ] Remove button (×) appears on each project item
- [ ] Removing a project removes it from the dropdown list
- [ ] Removing the active project clears the project path
- [ ] Window title updates when switching projects

## 7. Prompt Transformer

- [ ] Sparkle toggle button works (golden glow when ON)
- [ ] Auto-detect mode works: try "fix the login bug" → Debug mode
- [ ] Auto-detect mode works: try "write a function" → CodeTask mode
- [ ] Preview button (eye icon) shows transformed prompt
- [ ] Transform preview shows mode badge
- [ ] Raw mode (transformer OFF) sends message as-is
- [ ] Settings persist after restart

## 8. Web Search

- [ ] Globe toggle button works (blue glow when ON)
- [ ] Auto-triggers on search keywords ("what's the latest version of React?")
- [ ] Search spinner appears while searching
- [ ] Results bar appears with query and result count
- [ ] Results bar dismiss button works
- [ ] DuckDuckGo search works without API key
- [ ] Tavily search works with API key (if configured)
- [ ] Search does NOT trigger for non-search prompts

## 9. File Attachments

- [ ] Paperclip button opens file picker
- [ ] Drag-and-drop files onto input area works
- [ ] Attached file contents are included in the message
- [ ] Multiple files can be attached

## 10. Export & Search

- [ ] Export menu opens (Ctrl+Shift+E)
- [ ] Export as Markdown generates valid .md file
- [ ] Export as JSON generates valid .json file
- [ ] Conversation search (Ctrl+Shift+S) works
- [ ] Search results are clickable and navigate to correct session

## 11. System Prompt

- [ ] Settings modal opens (Ctrl+,)
- [ ] Custom system prompt saves correctly
- [ ] System prompt persists across messages
- [ ] Cancel button discards changes

## 12. Keyboard Shortcuts

- [ ] Ctrl+N — new chat
- [ ] Ctrl+Shift+S — search
- [ ] Ctrl+Shift+E — export
- [ ] Ctrl+, — settings
- [ ] Ctrl+Shift+M — model selector
- [ ] Escape — close all modals/dropdowns
- [ ] Enter — send message
- [ ] Shift+Enter — new line

## 13. Theme

- [ ] Dark/light toggle works
- [ ] Theme persists after restart (localStorage)
- [ ] All UI elements are readable in both themes
- [ ] No broken colors or invisible text in either theme

## 14. Multi-Agent System

- [ ] Agent panel opens from dashboard
- [ ] Default agents listed (Coder, Reviewer, Architect, Tester, Documenter)
- [ ] New agents listed (Hermes Reasoner, OpenClaw Coder, Hermes Analyst)
- [ ] Creating a workflow works
- [ ] Task routing works

## 15. Edge Cases & Error Handling

- [ ] Empty message cannot be sent (no crash)
- [ ] Very long messages don't break the UI
- [ ] Invalid API key shows a meaningful error
- [ ] Network error during streaming is handled gracefully
- [ ] Rapid clicking on buttons doesn't cause duplicate actions
- [ ] Multiple quick model switches don't crash
- [ ] Opening/closing modals rapidly doesn't cause state issues
- [ ] App works with no API keys configured (shows appropriate message)

## 16. Performance

- [ ] App launches in under 3 seconds
- [ ] No visible lag when typing in input bar
- [ ] Session list loads quickly (even with 50+ sessions)
- [ ] Scrolling through long conversations is smooth
- [ ] Memory usage stays stable during extended use
- [ ] No memory leaks from repeated session switching

## 17. Data Integrity

- [ ] Session files in `~/.claude/workspace-brain/sessions/` are valid JSON
- [ ] API keys file is valid JSON
- [ ] Transformer settings persist correctly
- [ ] Web search settings persist correctly
- [ ] No data corruption after crash/force-quit
- [ ] Concurrent reads/writes don't corrupt files

## 18. Security

- [ ] API keys are never displayed in full (always masked)
- [ ] API keys are not logged to console
- [ ] Password input type used for key entry
- [ ] Keys stored locally only (not sent to third parties)
- [ ] No sensitive data in git commits

---

## How to Use This Checklist

1. Go through each section systematically
2. Test on both Windows and macOS if possible
3. Mark items as you verify them
4. If any item fails, file a bug and note the section
5. Re-test after fixes
6. App is considered stable when ALL items pass
