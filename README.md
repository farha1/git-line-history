# Git Line History

A VS Code extension that provides dynamic git history annotations and diff viewing capabilities for your code. This extension helps developers understand code evolution by showing commit information and changes directly in the editor.

## Features

### 🔍 Line History Inspection
- Hover over any line to see its git history
- Shows commit information including:
  - Commit hash
  - Commit message
  - Author
  - Date of change

### 📝 Diff Viewing
- Click "Show Diff" in the hover message to open a side-by-side diff view

![Picture 1](images/screenshot-1.png)

- Formatted diff view that highlights:
  - Added lines (+)
  - Removed lines (-)
  - Context lines (...)
- Automatic cursor positioning to the relevant line in the diff

![Picture 2](images/screenshot-2.png)

### 🚀 Performance Features
- Smart caching for git history and diffs
- Debounced cursor movement handling
- Efficient diff formatting and display

## Usage

1. Open any file in your git repository
2. Move your cursor to any line
3. Look for the 🔍 indicator at the end of the line
4. Hover over the line to see its git history
5. Click "Show Diff" to view the detailed changes

## Notes
- If syntax highlighting doesn't appear in the diff view, it may be due to your chosen UI theme not providing syntax highlighting for `.diff` files.
- If text in the line that your cursor is hovering over is not visible in diff view, it may be the line doesn't exist in git diff output or there is no change in the line.