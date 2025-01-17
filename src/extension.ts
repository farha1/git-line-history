import * as vscode from "vscode";
import simpleGit, { SimpleGit } from "simple-git";
import * as path from "path";

let contentFormattedDiff = "";

// Create and register the diff content provider at extension activation
const diffContentProvider = new (class
  implements vscode.TextDocumentContentProvider
{
  provideTextDocumentContent(_uri: vscode.Uri): string {
    return contentFormattedDiff;
  }
})();

// Keep track of the current diff view URI
let currentDiffUri: vscode.Uri | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Register the provider early
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "diffview",
      diffContentProvider
    )
  );

  // Register the command to show diff in new file
  let disposable = vscode.commands.registerCommand(
    "dynamicCodeAnnotation.showDiffInNewFile",
    async (commitHash: string, lineText: string, filePath: string) => {
      try {
        const git = simpleGit(path.dirname(filePath));
        const diff = await getDiffForCommit(git, commitHash, filePath);
        const { formattedDiffOutput, selectedLine } = formatDiff(
          diff,
          lineText
        );

        contentFormattedDiff = formattedDiffOutput;
        // Create a URI for a readonly virtual document
        currentDiffUri = vscode.Uri.parse(
          `diffview://diff-view/${commitHash.slice(0, 9)}.diff`
        );

        // Open the document after the provider is registered
        const doc = await vscode.workspace.openTextDocument(currentDiffUri);

        // Set the language mode to diff
        await vscode.languages.setTextDocumentLanguage(doc, "diff");

        // Get editor reference after showing document
        const editor = await vscode.window.showTextDocument(doc, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
        });

        // Set cursor position (e.g., line 5 (zero-based), character 0)
        const position = new vscode.Position(
          selectedLine > 0 ? selectedLine - 1 : 0,
          0
        );
        editor.selection = new vscode.Selection(position, position);

        // Reveal the position
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
      }
    }
  );
  context.subscriptions.push(disposable);

  const activeEditor = vscode.window.activeTextEditor;

  if (activeEditor) {
    setupDiffLineInspect(activeEditor, context);
  }

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      setupDiffLineInspect(editor, context);
    }
  });
}

let decorationTimeout: NodeJS.Timeout | undefined;

function formatDiff(
  diff: string,
  selectedLineText: string
): { formattedDiffOutput: string; selectedLine: number } {
  const lines = diff.split("\n");
  let formattedDiff: string[] = [];
  let regularLine = false;
  let lineCount = 0;
  let selectedLine = 0;

  lines.forEach((line) => {
    if (/^([+@-]{2,3}|index|diff)/.test(line)) {
      return;
    } else if (line.startsWith("+")) {
      const lineText = line.substring(1);
      lineCount++;
      regularLine = false;
      if (lineText === selectedLineText) {
        selectedLine = lineCount;
      }
      formattedDiff.push(`+ ${lineText}`);
    } else if (/^ -/.test(line)) {
      const lineText = line.substring(2);
      lineCount++;
      regularLine = false;
      if (lineText === selectedLineText) {
        selectedLine = lineCount;
      }
      formattedDiff.push(`- ${lineText}`);
    } else if (line.startsWith("-")) {
      const lineText = line.substring(1);
      lineCount++;
      regularLine = false;
      if (lineText === selectedLineText) {
        selectedLine = lineCount;
      }
      formattedDiff.push(`- ${lineText}`);
    } else {
      if (regularLine) {
        return;
      }
      lineCount++;
      formattedDiff.push(` ...`);
      regularLine = true;
    }
  });

  formattedDiff.push("...");
  return {
    formattedDiffOutput: formattedDiff.join("\n"),
    selectedLine: selectedLine === 0 ? lineCount : selectedLine,
  };
}

function setupDiffLineInspect(
  editor: vscode.TextEditor,
  context: vscode.ExtensionContext
) {
  function updateDecorationsDebounced(editor: vscode.TextEditor) {
    // Clear the previous timeout if it exists
    if (decorationTimeout) {
      clearTimeout(decorationTimeout);
    }

    // Set a new timeout
    decorationTimeout = setTimeout(() => {
      updateDecorations(editor); // Call the original function
    }, 250); // Delay in milliseconds (adjust as needed)
  }

  let currentDecorationType: vscode.TextEditorDecorationType | undefined;

  const updateDecorations = async (editor: vscode.TextEditor) => {
    try {
      // Dispose previous decoration
      if (currentDecorationType) {
        currentDecorationType.dispose();
      }

      // Create new decoration type
      currentDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: "  🔍",
        },
      });

      const cursorLine = editor.selection.active.line; // Convert to 1-based index
      const document = editor.document;
      const filePath = document.uri.fsPath;

      // Mocking hotspot data, replace with actual data from analyzeGitHistory()
      const hotspots = await analyzeGitHistory(filePath);

      const hotspot = hotspots.find(
        (hotspot) => hotspot.line === cursorLine + 1
      );
      if (hotspot) {
        const lineText = document.lineAt(cursorLine).text; // Get the full line text
        const lineLength = lineText.length;

        const decorationOptions: vscode.DecorationOptions[] = [
          {
            range: new vscode.Range(cursorLine, 0, cursorLine, lineLength),
            hoverMessage: (() => {
              const markdown = new vscode.MarkdownString(
                `**Commit**: ${hotspot.commitHash.slice(0, 9)} ~ ${
                  hotspot.summary
                }\n\n` +
                  `**Author**: ${hotspot.author} \n` +
                  `**Date**: ${hotspot.date} \n\n` +
                  `[Show Diff](command:dynamicCodeAnnotation.showDiffInNewFile?${encodeURIComponent(
                    JSON.stringify([hotspot.commitHash, lineText, filePath])
                  )})`
              );
              markdown.isTrusted = true;
              return markdown;
            })(),
          },
        ];

        editor.setDecorations(currentDecorationType, decorationOptions);
      } else {
        editor.setDecorations(currentDecorationType, []);
      }
    } catch (err) {
      console.error("err : ", err);
    }
  };

  // Trigger decoration update on cursor movement
  const disposable = vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor === editor) {
      updateDecorationsDebounced(editor);
    }
  });

  context.subscriptions.push(disposable);
}

// Add cache for commit diffs
const commitDiffCache = new Map<string, string>();

async function getDiffForCommit(
  git: SimpleGit,
  commitHash: string,
  filePath: string
): Promise<string> {
  const cacheKey = `${commitHash}:${filePath}`;
  if (commitDiffCache.has(cacheKey)) {
    return commitDiffCache.get(cacheKey)!;
  }
  try {
    const diffOutput = await git.raw([
      "diff",
      `${commitHash}^!`,
      "--",
      filePath,
    ]);

    commitDiffCache.set(cacheKey, diffOutput);
    return diffOutput;
  } catch (error) {
    console.error(`Error fetching diff for commit ${commitHash}:`, error);
    return "file not found";
  }
}

const gitHistoryCache = new Map<
  string,
  Array<{
    line: number;
    author: string;
    summary: string;
    date: string;
    commitHash: string;
  }>
>();

async function analyzeGitHistory(filePath: string): Promise<
  {
    line: number;
    author: string;
    summary: string;
    date: string;
    commitHash: string;
  }[]
> {
  const git: SimpleGit = simpleGit(path.dirname(filePath));
  const headHash = await git.raw(["rev-parse", "-short", "HEAD"]);
  // generate cache key
  const cacheKey = `${filePath}:${headHash}`;
  // Check cache first
  if (gitHistoryCache.has(cacheKey)) {
    return gitHistoryCache.get(cacheKey)!;
  }

  try {
    const blameOutput = await git.raw(["blame", "-p", filePath]);

    // Process blame data
    const hotspots: {
      [line: number]: {
        author: string;
        summary: string;
        date: string;
        commitHash: string;
      };
    } = {};
    const blameLines = blameOutput.split("\n");

    let hashMap: {
      [key: string]: { author: string; date: string; summary: string };
    } = {};
    let currentCommitHash = "";
    let currentResultingLine = 0;

    for (const [i, line] of blameLines.entries()) {
      if (/^\S+\s+\d+\s+\d+/.test(line)) {
        const commitInfo = line.split(" ");
        if (commitInfo) {
          currentCommitHash = commitInfo[0];
          if (!hashMap[currentCommitHash]) {
            hashMap[currentCommitHash] = {
              author: blameLines[i + 1].substring(7).trim(),
              date: blameLines[i + 7].substring(15).trim(),
              summary: blameLines[i + 9].substring(8).trim(),
            };
          }
          currentResultingLine = parseInt(commitInfo[2], 10);
        }
      }
      hotspots[currentResultingLine] = {
        author: hashMap[currentCommitHash].author,
        summary: hashMap[currentCommitHash].summary,
        date: formatUnixTimestamp(Number(hashMap[currentCommitHash].date)),
        commitHash: currentCommitHash,
      };
    }

    const gitHistory = Object.keys(hotspots).map((line) => ({
      line: parseInt(line),
      author: hotspots[parseInt(line)].author,
      summary: hotspots[parseInt(line)].summary,
      date: hotspots[parseInt(line)].date,
      commitHash: hotspots[parseInt(line)].commitHash,
    }));

    gitHistoryCache.set(cacheKey, gitHistory);

    return gitHistory;
  } catch (error) {
    console.error("Error analyzing Git history:", error);
    throw error;
  }
}

function formatUnixTimestamp(unixTimestamp: number) {
  // Convert Unix timestamp (in seconds) to milliseconds
  const date = new Date(unixTimestamp * 1000);

  // Format the date
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-based
  const day = String(date.getDate()).padStart(2, "0");

  // Return formatted date string
  return `${year}-${month}-${day}`;
}

export function deactivate() {
  commitDiffCache.clear();
  gitHistoryCache.clear();
  contentFormattedDiff = "";
}
