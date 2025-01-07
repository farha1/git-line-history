import * as vscode from "vscode";
import simpleGit, { SimpleGit } from "simple-git";
import * as path from "path";

let diffString = "";
let selectedLine = 0;

// Create a setter for diffString that triggers content update
const setDiffString = (diffUri: vscode.Uri) => {
  diffContentProvider.update(diffUri);
};

// Create and register the diff content provider at extension activation
const diffContentProvider = new (class
  implements vscode.TextDocumentContentProvider
{
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return diffString;
  }

  update(uri: vscode.Uri) {
    this._onDidChange.fire(uri);
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
    async () => {
      try {
        // Create a URI for a readonly virtual document
        currentDiffUri = vscode.Uri.parse("diffview://diff-view");
        setDiffString(currentDiffUri);

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
        const position = new vscode.Position(selectedLine - 1, 0);
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
    setupDynamicComments(activeEditor, context);
  }

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      setupDynamicComments(editor, context);
    }
  });
}

let decorationTimeout: NodeJS.Timeout | undefined;

function setupDynamicComments(
  editor: vscode.TextEditor,
  context: vscode.ExtensionContext
) {
  const decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: "rgba(150, 150, 150, 0.8)",
      fontStyle: "italic",
    },
  });

  function updateDecorationsDebounced(editor: vscode.TextEditor) {
    // Clear the previous timeout if it exists
    if (decorationTimeout) {
      clearTimeout(decorationTimeout);
    }

    // Set a new timeout
    decorationTimeout = setTimeout(() => {
      updateDecorations(editor); // Call the original function
    }, 500); // Delay in milliseconds (adjust as needed)
  }

  function formatDiffOutput(diff: string, selectedLineText: string): string {
    const lines = diff.split("\n");
    let formattedDiff = "";
    let regularLine = false;
    let lineCount = 0;

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
        formattedDiff += `+ ${lineText}\n`;
      } else if (line.startsWith("-")) {
        const lineText = line.substring(1);
        lineCount++;
        regularLine = false;
        if (lineText === selectedLineText) {
          selectedLine = lineCount;
        }
        formattedDiff += `- ${lineText}\n`;
      } else {
        if (regularLine) {
          return;
        }
        lineCount++;
        formattedDiff += ` ...\n`;
        regularLine = true;
      }
    });

    formattedDiff += "...";
    return formattedDiff;
  }

  const updateDecorations = async (editor: vscode.TextEditor) => {
    const cursorLine = editor.selection.active.line; // Convert to 1-based index

    const document = editor.document;
    const filePath = document.uri.fsPath;

    // Mocking hotspot data, replace with actual data from analyzeGitHistory()
    const hotspots = await analyzeGitHistory(filePath);

    const hotspot = hotspots.find((hotspot) => hotspot.line === cursorLine + 1);

    if (hotspot) {
      const lineText = document.lineAt(cursorLine).text; // Get the full line text
      const lineLength = lineText.length;

      const git = simpleGit(path.dirname(filePath));
      const diff = await getDiffForCommit(git, hotspot.commitHash, filePath);
      const formattedDiff = formatDiffOutput(diff, lineText);

      diffString = formattedDiff;
      const decorationOptions: vscode.DecorationOptions[] = [
        {
          range: new vscode.Range(cursorLine, 0, cursorLine, lineLength),
          hoverMessage: (() => {
            const markdown = new vscode.MarkdownString(
              `**Commit**: ${hotspot.commitHash.slice(0, 7)}\n` +
                `**Author**: ${hotspot.author}\n` +
                `**Date**: ${hotspot.date}\n` +
                `**Summary**: ${hotspot.summary}\n\n` +
                `[Show Diff in New File](command:dynamicCodeAnnotation.showDiffInNewFile)`
            );
            markdown.isTrusted = true;
            return markdown;
          })(),
        },
      ];
      editor.setDecorations(decorationType, decorationOptions);
    } else {
      editor.setDecorations(decorationType, []);
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

export function deactivate() {}

async function getDiffForCommit(
  git: SimpleGit,
  commitHash: string,
  filePath: string
): Promise<string> {
  try {
    const diffOutput = await git.raw([
      "diff",
      `${commitHash}^!`,
      "--",
      filePath,
    ]);

    return diffOutput;
  } catch (error) {
    console.error(`Error fetching diff for commit ${commitHash}:`, error);
    return "file not found";
  }
}

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

    return Object.keys(hotspots).map((line) => ({
      line: parseInt(line),
      author: hotspots[parseInt(line)].author,
      summary: hotspots[parseInt(line)].summary,
      date: hotspots[parseInt(line)].date,
      commitHash: hotspots[parseInt(line)].commitHash,
    }));
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
