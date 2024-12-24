import * as vscode from "vscode";
import simpleGit, { SimpleGit } from "simple-git";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  console.log("Dynamic Code Annotation is now active!");

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

  const updateDecorations = async (editor: vscode.TextEditor) => {
    const cursorLine = editor.selection.active.line; // Convert to 1-based index

    const document = editor.document;
    const filePath = document.uri.fsPath;

    // Mocking hotspot data, replace with actual data from analyzeGitHistory()
    const hotspots = await analyzeGitHistory(filePath);

    const hotspot = hotspots.find((hotspot) => hotspot.line === cursorLine);

    if (hotspot) {
      const git = simpleGit(path.dirname(filePath));
      const commitHash = hotspot.commitHash.split(" ")[0];
      const diff = await getDiffForCommit(git, commitHash, filePath);

      const lineText = document.lineAt(cursorLine).text; // Get the full line text
      const lineLength = lineText.length;

      const decorationOptions: vscode.DecorationOptions[] = [
        {
          range: new vscode.Range(cursorLine, 0, cursorLine, lineLength),
          hoverMessage: `Hash :${commitHash}\n\n${diff}`,
          renderOptions: {
            after: {
              contentText: ` -> ${hotspot.author} | ${hotspot.date} | ${hotspot.summary}`,
            },
          },
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
    // Get the file's relative path from the repo root
    const relativePath = path.relative(
      await git.revparse("--show-toplevel"),
      filePath
    );

    // const diffOutput = await git.raw(["show", `${commitHash}:${relativePath}`]);
    const diffOutput = await git.raw([
      "diff",
      `${commitHash}^!`,
      "--",
      relativePath,
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

    let currentAuthor = "Unknown";
    let currentSummary = "";
    let currentDate = "";
    let currentCommitHash = "";
    let currentResultingLine = 0;

    for (const [_, line] of blameLines.entries()) {
      if (line.startsWith("author ")) {
        // Extract the author name
        currentAuthor = line.substring(7).trim();
      } else if (line.startsWith("summary ")) {
        // Extract the commit summary
        currentSummary = line.substring(8).trim();
      } else if (line.startsWith("committer-time ")) {
        // Extract the commit summary
        currentDate = line.substring(15).trim();
      } else if (/^\S+\s+\d+\s+\d+/.test(line)) {
        const commitInfo = line.split(" ");
        if (commitInfo) {
          currentCommitHash = commitInfo[0];
          currentResultingLine = parseInt(commitInfo[1], 10) - 1;
        }
      }
      hotspots[currentResultingLine] = {
        author: currentAuthor,
        summary: currentSummary,
        date: formatUnixTimestamp(Number(currentDate)),
        commitHash: currentCommitHash,
      };
    }
    console.log(hotspots);

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
