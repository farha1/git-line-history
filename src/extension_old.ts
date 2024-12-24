import * as vscode from "vscode";
import simpleGit, { SimpleGit } from "simple-git";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  console.log("Dynamic Code Annotation is now active!");

  const disposable = vscode.commands.registerCommand(
    "extension.showHotspots",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found!");
        return;
      }

      const document = editor.document;
      const filePath = document.uri.fsPath;

      try {
        // Analyze Git history and highlight hotspots
        const hotspots = await analyzeGitHistory(filePath);

        highlightHotspotsAsComments(editor, hotspots);
        // highlightHotspots(editor, hotspots);
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Error analyzing Git history: ${error.message}`
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

// Highlight hotspots in the editor
function highlightHotspots(
  editor: vscode.TextEditor,
  hotspots: { line: number; edits: number; author: string }[]
) {
  const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255,0,0,0.2)", // Light red for hotspots
  });

  const decorations = hotspots.map((hotspot) => ({
    range: new vscode.Range(hotspot.line - 1, 0, hotspot.line - 1, 100),
    hoverMessage: `Edited ${hotspot.edits} times by ${hotspot.author}`,
  }));

  editor.setDecorations(decorationType, decorations);
}

async function highlightHotspotsAsComments(
  editor: vscode.TextEditor,
  hotspots: { line: number; edits: number; author: string }[]
) {
  await editor.edit((editBuilder) => {
    hotspots.forEach((hotspot) => {
      // Calculate the position to insert the comment
      const line = hotspot.line - 1; // Convert to zero-based index
      const position = new vscode.Position(
        line,
        editor.document.lineAt(line).text.length
      );

      // Create the comment text
      const commentText = ` // Edited ${hotspot.edits} times by ${hotspot.author}`;

      // Insert the comment at the end of the line
      if (!editor.document.lineAt(line).text.includes(commentText.trim())) {
        editBuilder.insert(position, commentText);
      }
    });
  });
}

// Analyze Git history for a file
async function analyzeGitHistory(
  filePath: string
): Promise<{ line: number; edits: number; author: string }[]> {
  const git: SimpleGit = simpleGit(path.dirname(filePath));

  try {
    const blameOutput = await git.raw(["blame", "-p", filePath]);
    console.log("Git Blame Output:", blameOutput);

    // Process blame data
    const hotspots: { [line: number]: { edits: number; author: string } } = {};
    const blameLines = blameOutput.split("\n");

    let currentAuthor = "Unknown";

    blameLines.forEach((line, index) => {
      if (line.startsWith("author ")) {
        // Extract the author name
        currentAuthor = line.substring(7).trim();
      } else if (/^\S+\s+\d+\s+\d+/.test(line)) {
        // Match lines like "<commit-hash> <original-line> <resulting-line>"
        const match = line.match(/^\S+\s+\d+\s+(\d+)/);
        if (match) {
          const resultingLine = parseInt(match[1], 10);

          if (!hotspots[resultingLine]) {
            hotspots[resultingLine] = { edits: 0, author: currentAuthor };
          }
          hotspots[resultingLine].edits += 1;
        }
      }
      //   console.log(`Processing line ${index}:`, line);
      // const match = line.match(/^([a-f0-9]+)\s(\d+)\s(\d+)/);
      // if (match) {
      //   const [, commitHash, lineNumber] = match;
      //   const authorMatch = blameOutput.match(
      //     new RegExp(`${commitHash}\s+author\s+(.+)`)
      //   );
      //   const author = authorMatch ? authorMatch[1] : "Unknown";

      //   const line = parseInt(lineNumber);
      //   if (!hotspots[line]) {
      //     hotspots[line] = { edits: 0, author };
      //   }
      //   hotspots[line].edits += 1;
      // }
    });

    return Object.keys(hotspots).map((line) => ({
      line: parseInt(line),
      edits: hotspots[parseInt(line)].edits,
      author: hotspots[parseInt(line)].author,
    }));
  } catch (error) {
    console.error("Error analyzing Git history:", error);
    throw error;
  }
}
