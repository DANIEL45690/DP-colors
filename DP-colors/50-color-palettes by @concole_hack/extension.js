
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { ColorPalettesProvider } = require("./src/palettesProvider");
const { colorPalettes } = require("./src/palettes");

let currentTheme = null;
let decorationTimeout = null;
let statusBarItem = null;
let outputChannel = null;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Color Palettes");
  outputChannel.appendLine(
    "Extension activated at " + new Date().toISOString(),
  );

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = "$(color-mode) Color Palettes";
  statusBarItem.tooltip = "Click to open Color Palettes";
  statusBarItem.command = "colorPalettes.openView";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const themesDir = path.join(context.extensionPath, "themes");
  if (!fs.existsSync(themesDir)) {
    fs.mkdirSync(themesDir, { recursive: true });
    outputChannel.appendLine("Created themes directory at " + themesDir);
  }

  const provider = new ColorPalettesProvider(context);
  const view = vscode.window.createTreeView("colorPalettesView", {
    treeDataProvider: provider,
    showCollapseAll: true,
    dragAndDropController: provider,
  });
  context.subscriptions.push(view);

  initializeThemeFiles(context);
  registerAllThemesInPackageJson(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("colorPalettes.openView", async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.color-palettes-sidebar",
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "colorPalettes.applyTheme",
      async (palette) => {
        if (!palette) {
          outputChannel.appendLine("No palette provided to applyTheme");
          return;
        }

        outputChannel.appendLine(
          `Applying theme: ${palette.name} (${palette.id})`,
        );

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Applying ${palette.name} palette...`,
            cancellable: false,
          },
          async (progress) => {
            progress.report({
              increment: 0,
              message: "Creating theme file...",
            });

            try {
              const themePath = await createThemeFile(context, palette);
              progress.report({
                increment: 30,
                message: "Registering theme...",
              });

              await ensureThemeRegistered(context, palette, themePath);
              progress.report({ increment: 30, message: "Applying colors..." });

              await applyThemeColors(palette);
              progress.report({ increment: 30, message: "Finalizing..." });

              await finalizeThemeApplication(palette);
              progress.report({ increment: 10, message: "Done!" });

              currentTheme = palette;
              updateStatusBar(palette);

              outputChannel.appendLine(
                `Successfully applied theme: ${palette.name}`,
              );
              vscode.window.showInformationMessage(
                `✨ Applied "${palette.name}" palette successfully!`,
              );

              showColorPreviewNotification(palette);
              logThemeUsage(palette);
            } catch (error) {
              outputChannel.appendLine(
                `Error applying theme: ${error.message}`,
              );
              vscode.window.showErrorMessage(
                `Failed to apply theme: ${error.message}`,
              );
            }
          },
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "colorPalettes.refreshPalettes",
      async () => {
        outputChannel.appendLine("Refreshing palettes view");
        provider.refresh();
        await regenerateAllThemeFiles(context);
        vscode.window.showInformationMessage(
          "🔄 All palettes refreshed and regenerated",
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "colorPalettes.exportPalette",
      async (palette) => {
        if (!palette) return;

        outputChannel.appendLine(`Exporting palette: ${palette.name}`);

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const defaultName = `${palette.name.toLowerCase().replace(/\s+/g, "_")}_${timestamp}`;

        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`${defaultName}.json`),
          filters: {
            "JSON files": ["json"],
            "Color Palette": ["palette"],
          },
        });

        if (uri) {
          const exportData = {
            metadata: {
              name: palette.name,
              description: palette.description,
              category: palette.category,
              id: palette.id,
              exportedAt: new Date().toISOString(),
              version: "1.0.0",
            },
            colors: palette.colors,
            preview: palette.preview,
            syntax: palette.syntax || [],
            settings: {
              animationSpeed: vscode.workspace
                .getConfiguration()
                .get("colorPalettes.animationSpeed", 300),
              defaultView: vscode.workspace
                .getConfiguration()
                .get("colorPalettes.defaultView", "grid"),
            },
          };

          const content = JSON.stringify(exportData, null, 2);
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(content, "utf8"),
          );

          outputChannel.appendLine(`Exported palette to: ${uri.fsPath}`);
          vscode.window.showInformationMessage(
            `💾 Exported "${palette.name}" palette to ${path.basename(uri.fsPath)}`,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("colorPalettes.importPalette", async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          "JSON files": ["json", "palette"],
        },
      });

      if (uris && uris[0]) {
        try {
          const content = await vscode.workspace.fs.readFile(uris[0]);
          const imported = JSON.parse(content.toString());

          const newPalette = {
            id: `imported_${Date.now()}`,
            name:
              imported.metadata?.name || path.basename(uris[0].fsPath, ".json"),
            description:
              imported.metadata?.description || "Imported custom palette",
            category: "Custom",
            preview: imported.preview || {
              bg: "#000000",
              text: "#ffffff",
              accent: "#ff0000",
            },
            colors: imported.colors,
            syntax: imported.syntax || [],
          };

          colorPalettes.push(newPalette);
          await createThemeFile(context, newPalette);
          provider.refresh();

          outputChannel.appendLine(`Imported palette: ${newPalette.name}`);
          vscode.window.showInformationMessage(
            `📥 Imported "${newPalette.name}" palette successfully!`,
          );
        } catch (error) {
          outputChannel.appendLine(`Error importing palette: ${error.message}`);
          vscode.window.showErrorMessage(
            `Failed to import palette: ${error.message}`,
          );
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "colorPalettes.resetToDefault",
      async () => {
        const answer = await vscode.window.showWarningMessage(
          "Reset all color customizations to default?",
          "Yes",
          "Cancel",
        );

        if (answer === "Yes") {
          const config = vscode.workspace.getConfiguration();
          await config.update(
            "workbench.colorCustomizations",
            {},
            vscode.ConfigurationTarget.Global,
          );
          await config.update(
            "workbench.colorTheme",
            undefined,
            vscode.ConfigurationTarget.Global,
          );

          outputChannel.appendLine("Reset to default theme");
          vscode.window.showInformationMessage(
            "🔄 Reset to default theme successfully",
          );

          setTimeout(() => {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
          }, 1000);
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "colorPalettes.showPaletteInfo",
      async (palette) => {
        if (!palette) return;

        const colorPreviews = Object.entries(palette.colors)
          .slice(0, 8)
          .map(([name, value]) => {
            return `${name}: ${value}`;
          })
          .join("\n");

        vscode.window
          .showInformationMessage(
            `${palette.name}\n${palette.description}\n\nColors:\n${colorPreviews}`,
            { modal: true },
            "Apply",
            "Export",
            "Close",
          )
          .then((selection) => {
            if (selection === "Apply") {
              vscode.commands.executeCommand(
                "colorPalettes.applyTheme",
                palette,
              );
            } else if (selection === "Export") {
              vscode.commands.executeCommand(
                "colorPalettes.exportPalette",
                palette,
              );
            }
          });
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("colorPalettes.cycleThemes", async () => {
      const allPalettes = getAllPalettes();
      if (allPalettes.length === 0) return;

      let currentIndex = allPalettes.findIndex(
        (p) => p.id === currentTheme?.id,
      );
      currentIndex = (currentIndex + 1) % allPalettes.length;
      const nextTheme = allPalettes[currentIndex];

      await vscode.commands.executeCommand(
        "colorPalettes.applyTheme",
        nextTheme,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("colorPalettes.randomTheme", async () => {
      const allPalettes = getAllPalettes();
      const randomIndex = Math.floor(Math.random() * allPalettes.length);
      const randomTheme = allPalettes[randomIndex];

      await vscode.commands.executeCommand(
        "colorPalettes.applyTheme",
        randomTheme,
      );
      vscode.window.showInformationMessage(
        `🎲 Random theme: ${randomTheme.name}`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "colorPalettes.searchPalettes",
      async () => {
        const searchTerm = await vscode.window.showInputBox({
          prompt: "Search for color palettes",
          placeHolder: "e.g., dark, neon, ocean, sunset...",
        });

        if (searchTerm) {
          const results = getAllPalettes().filter(
            (p) =>
              p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              p.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
              p.category.toLowerCase().includes(searchTerm.toLowerCase()),
          );

          if (results.length > 0) {
            const selected = await vscode.window.showQuickPick(
              results.map((p) => ({
                label: `🎨 ${p.name}`,
                description: p.category,
                detail: p.description,
                palette: p,
              })),
              { placeHolder: `Found ${results.length} matching palettes` },
            );

            if (selected) {
              await vscode.commands.executeCommand(
                "colorPalettes.applyTheme",
                selected.palette,
              );
            }
          } else {
            vscode.window.showWarningMessage(
              `No palettes found matching "${searchTerm}"`,
            );
          }
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "colorPalettes.createCustomPalette",
      async () => {
        const name = await vscode.window.showInputBox({
          prompt: "Enter palette name",
          placeHolder: "My Custom Theme",
        });
        if (!name) return;

        const description = await vscode.window.showInputBox({
          prompt: "Enter description",
          placeHolder: "My awesome custom theme",
        });

        const bgColor = await vscode.window.showInputBox({
          prompt: "Background color",
          placeHolder: "#1e1e1e",
          value: "#1e1e1e",
        });
        const fgColor = await vscode.window.showInputBox({
          prompt: "Foreground color",
          placeHolder: "#d4d4d4",
          value: "#d4d4d4",
        });
        const accentColor = await vscode.window.showInputBox({
          prompt: "Accent color",
          placeHolder: "#007acc",
          value: "#007acc",
        });

        const newPalette = {
          id: `custom_${Date.now()}`,
          name: name,
          description: description || "Custom created theme",
          category: "Custom",
          preview: { bg: bgColor, text: fgColor, accent: accentColor },
          colors: {
            background: bgColor,
            foreground: fgColor,
            selection: `${accentColor}30`,
            lineHighlight: `${accentColor}10`,
            cursor: accentColor,
            whitespace: `${fgColor}10`,
          },
        };

        colorPalettes.push(newPalette);
        await createThemeFile(context, newPalette);
        provider.refresh();

        vscode.window.showInformationMessage(
          `✨ Created custom palette "${name}"`,
        );
        await vscode.commands.executeCommand(
          "colorPalettes.applyTheme",
          newPalette,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "colorPalettes.deleteCustomPalette",
      async (palette) => {
        if (!palette || palette.category !== "Custom") {
          vscode.window.showWarningMessage(
            "Only custom palettes can be deleted",
          );
          return;
        }

        const answer = await vscode.window.showWarningMessage(
          `Delete "${palette.name}"?`,
          { modal: true },
          "Yes",
          "No",
        );

        if (answer === "Yes") {
          const index = colorPalettes.findIndex((p) => p.id === palette.id);
          if (index !== -1) {
            colorPalettes.splice(index, 1);

            const themePath = path.join(
              context.extensionPath,
              "themes",
              `${palette.id}.json`,
            );
            if (fs.existsSync(themePath)) {
              fs.unlinkSync(themePath);
            }

            provider.refresh();
            outputChannel.appendLine(`Deleted custom palette: ${palette.name}`);
            vscode.window.showInformationMessage(
              `🗑️ Deleted "${palette.name}"`,
            );
          }
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("colorPalettes.toggleAutoCycle", () => {
      let isCycling = false;
      let interval = null;

      const stopCycling = () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
          isCycling = false;
          statusBarItem.text = "$(color-mode) Color Palettes";
          vscode.window.showInformationMessage("Auto-cycle stopped");
        }
      };

      if (!isCycling) {
        const intervalSec = vscode.workspace
          .getConfiguration()
          .get("colorPalettes.autoCycleInterval", 30);
        isCycling = true;
        statusBarItem.text = "$(sync~spin) Auto-cycling";

        interval = setInterval(async () => {
          await vscode.commands.executeCommand("colorPalettes.randomTheme");
        }, intervalSec * 1000);

        vscode.window.showInformationMessage(
          `Auto-cycle started (every ${intervalSec} seconds)`,
        );

        vscode.window
          .showInformationMessage(
            'Auto-cycling active. Click "Stop Auto-cycle" to stop.',
            "Stop Auto-cycle",
          )
          .then((selection) => {
            if (selection === "Stop Auto-cycle") {
              stopCycling();
            }
          });
      } else {
        stopCycling();
      }

      context.subscriptions.push({ dispose: stopCycling });
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration("colorPalettes.animationSpeed") ||
        e.affectsConfiguration("colorPalettes.defaultView")
      ) {
        provider.refresh();
        outputChannel.appendLine("Configuration changed, refreshing view");
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(async () => {
      const currentThemeName = vscode.workspace
        .getConfiguration()
        .get("workbench.colorTheme");
      const matchedPalette = getAllPalettes().find(
        (p) =>
          currentThemeName.includes(p.name) || currentThemeName.includes(p.id),
      );

      if (matchedPalette) {
        currentTheme = matchedPalette;
        updateStatusBar(matchedPalette);
      }
    }),
  );

  outputChannel.appendLine(
    `Extension fully activated with ${colorPalettes.length} color palettes`,
  );
  vscode.window.setStatusBarMessage(
    `🎨 Color Palettes: ${colorPalettes.length} themes ready`,
    3000,
  );
}

async function initializeThemeFiles(context) {
  outputChannel.appendLine("Initializing theme files...");
  const promises = colorPalettes.map((palette) =>
    createThemeFile(context, palette),
  );
  await Promise.all(promises);
  outputChannel.appendLine(`Initialized ${colorPalettes.length} theme files`);
}

async function createThemeFile(context, palette) {
  const themePath = path.join(
    context.extensionPath,
    "themes",
    `${palette.id}.json`,
  );
  const themeContent = generateComprehensiveThemeFile(palette);
  fs.writeFileSync(themePath, themeContent, "utf8");
  outputChannel.appendLine(`Created theme file: ${palette.id}.json`);
  return themePath;
}

async function regenerateAllThemeFiles(context) {
  outputChannel.appendLine("Regenerating all theme files...");
  const promises = colorPalettes.map((palette) =>
    createThemeFile(context, palette),
  );
  await Promise.all(promises);
  outputChannel.appendLine("All theme files regenerated");
}

function generateComprehensiveThemeFile(palette) {
  const theme = {
    name: `Color Palettes - ${palette.name}`,
    type: palette.category === "Light" ? "light" : "dark",
    colors: {
      "editor.background": palette.colors.background,
      "editor.foreground": palette.colors.foreground,
      "editor.selectionBackground": palette.colors.selection,
      "editor.selectionHighlightBackground": palette.colors.selection,
      "editor.lineHighlightBackground": palette.colors.lineHighlight,
      "editor.lineHighlightBorder": palette.colors.cursor,
      "editorCursor.foreground": palette.colors.cursor,
      "editorCursor.background": palette.colors.background,
      "editorWhitespace.foreground": palette.colors.whitespace,
      "editorIndentGuide.background": palette.colors.whitespace,
      "editorIndentGuide.activeBackground": palette.colors.cursor,
      "editorRuler.foreground": palette.colors.whitespace,
      "editorCodeLens.foreground": palette.colors.foreground,
      "editorBracketMatch.background": palette.colors.selection,
      "editorBracketMatch.border": palette.colors.cursor,
      "editorOverviewRuler.border": palette.colors.whitespace,
      "editorGutter.background": palette.colors.background,
      "editorGutter.modifiedBackground": palette.colors.cursor,
      "editorGutter.addedBackground": palette.colors.cursor,
      "editorGutter.deletedBackground": palette.colors.cursor,
      "editorError.foreground": "#ff0000",
      "editorWarning.foreground": "#ffcc00",
      "editorInfo.foreground": "#00ccff",
      "editorHint.foreground": palette.colors.cursor,
      "editorBracketHighlight.foreground1": palette.colors.cursor,
      "editorBracketHighlight.foreground2": palette.colors.foreground,
      "editorBracketHighlight.foreground3": palette.colors.whitespace,
      "editorBracketHighlight.foreground4": palette.colors.cursor,
      "editorBracketHighlight.foreground5": palette.colors.foreground,
      "editorBracketHighlight.foreground6": palette.colors.whitespace,
      "editorBracketHighlight.unexpectedBracket.foreground": "#ff0000",
      "editorOverviewRuler.errorForeground": "#ff0000",
      "editorOverviewRuler.warningForeground": "#ffcc00",
      "editorOverviewRuler.infoForeground": "#00ccff",
      "editorOverviewRuler.bracketMatchForeground": palette.colors.cursor,
      "editorOverviewRuler.findMatchForeground": palette.colors.cursor,
      "editorOverviewRuler.selectionHighlightForeground":
        palette.colors.selection,
      "editorOverviewRuler.wordHighlightForeground": palette.colors.selection,
      "editorOverviewRuler.wordHighlightStrongForeground":
        palette.colors.cursor,
      "editorOverviewRuler.modifiedForeground": palette.colors.cursor,
      "editorOverviewRuler.addedForeground": palette.colors.cursor,
      "editorOverviewRuler.deletedForeground": palette.colors.cursor,
      "minimap.background": palette.colors.background,
      "minimap.foregroundOpacity": "#ffffff60",
      "minimap.selectionHighlight": palette.colors.selection,
      "minimap.findMatchHighlight": palette.colors.selection,
      "minimap.errorHighlight": "#ff000080",
      "minimap.warningHighlight": "#ffcc0080",
      "minimap.infoHighlight": "#00ccff80",
      "minimapGutter.addedBackground": palette.colors.cursor,
      "minimapGutter.modifiedBackground": palette.colors.cursor,
      "minimapGutter.deletedBackground": palette.colors.cursor,
      "minimapSlider.background": palette.colors.selection,
      "minimapSlider.hoverBackground": palette.colors.selection,
      "minimapSlider.activeBackground": palette.colors.cursor,
      "scrollbar.shadow": "#00000030",
      "scrollbarSlider.background": palette.colors.selection,
      "scrollbarSlider.hoverBackground": palette.colors.selection,
      "scrollbarSlider.activeBackground": palette.colors.cursor,
      "activityBar.background": palette.colors.background,
      "activityBar.foreground": palette.colors.foreground,
      "activityBar.inactiveForeground": palette.colors.whitespace,
      "activityBar.border": palette.colors.whitespace,
      "activityBar.activeBorder": palette.colors.cursor,
      "activityBar.activeBackground": palette.colors.selection,
      "activityBar.dropBackground": palette.colors.selection,
      "activityBarBadge.background": palette.colors.cursor,
      "activityBarBadge.foreground": palette.colors.background,
      "sideBar.background": palette.colors.background,
      "sideBar.foreground": palette.colors.foreground,
      "sideBar.border": palette.colors.whitespace,
      "sideBarTitle.foreground": palette.colors.foreground,
      "sideBarSectionHeader.background": palette.colors.selection,
      "sideBarSectionHeader.foreground": palette.colors.foreground,
      "sideBarSectionHeader.border": palette.colors.whitespace,
      "statusBar.background": palette.colors.background,
      "statusBar.foreground": palette.colors.foreground,
      "statusBar.border": palette.colors.whitespace,
      "statusBar.noFolderBackground": palette.colors.background,
      "statusBar.debuggingBackground": "#00ccff",
      "statusBar.debuggingForeground": "#ffffff",
      "statusBarItem.activeBackground": palette.colors.selection,
      "statusBarItem.hoverBackground": palette.colors.selection,
      "statusBarItem.prominentBackground": palette.colors.cursor,
      "statusBarItem.prominentHoverBackground": palette.colors.cursor,
      "statusBarItem.remoteBackground": palette.colors.cursor,
      "statusBarItem.remoteForeground": palette.colors.background,
      "titleBar.activeBackground": palette.colors.background,
      "titleBar.activeForeground": palette.colors.foreground,
      "titleBar.inactiveBackground": palette.colors.background,
      "titleBar.inactiveForeground": palette.colors.whitespace,
      "titleBar.border": palette.colors.whitespace,
      "menubar.selectionBackground": palette.colors.selection,
      "menubar.selectionForeground": palette.colors.foreground,
      "menu.background": palette.colors.background,
      "menu.foreground": palette.colors.foreground,
      "menu.border": palette.colors.whitespace,
      "menu.selectionBackground": palette.colors.selection,
      "menu.selectionForeground": palette.colors.foreground,
      "menu.selectionBorder": palette.colors.cursor,
      "panel.background": palette.colors.background,
      "panel.border": palette.colors.whitespace,
      "panelTitle.activeBorder": palette.colors.cursor,
      "panelTitle.activeForeground": palette.colors.foreground,
      "panelTitle.inactiveForeground": palette.colors.whitespace,
      "terminal.background": palette.colors.background,
      "terminal.foreground": palette.colors.foreground,
      "terminalCursor.foreground": palette.colors.cursor,
      "terminalCursor.background": palette.colors.background,
      "terminal.selectionBackground": palette.colors.selection,
      "terminal.border": palette.colors.whitespace,
      "terminal.ansiBlack": "#000000",
      "terminal.ansiRed": "#ff0000",
      "terminal.ansiGreen": "#00ff00",
      "terminal.ansiYellow": "#ffff00",
      "terminal.ansiBlue": "#0000ff",
      "terminal.ansiMagenta": "#ff00ff",
      "terminal.ansiCyan": "#00ffff",
      "terminal.ansiWhite": "#ffffff",
      "terminal.ansiBrightBlack": "#808080",
      "terminal.ansiBrightRed": "#ff4444",
      "terminal.ansiBrightGreen": "#44ff44",
      "terminal.ansiBrightYellow": "#ffff44",
      "terminal.ansiBrightBlue": "#4444ff",
      "terminal.ansiBrightMagenta": "#ff44ff",
      "terminal.ansiBrightCyan": "#44ffff",
      "terminal.ansiBrightWhite": "#ffffff",
      "debugToolBar.background": palette.colors.background,
      "debugToolBar.border": palette.colors.whitespace,
      "editor.stackFrameHighlightBackground": "#ffff0030",
      "editor.focusedStackFrameHighlightBackground": "#00ff0030",
      "notifications.background": palette.colors.background,
      "notifications.foreground": palette.colors.foreground,
      "notifications.border": palette.colors.whitespace,
      "notificationLink.foreground": palette.colors.cursor,
      "notificationCenterHeader.background": palette.colors.selection,
      "notificationCenterHeader.foreground": palette.colors.foreground,
      "notificationToast.border": palette.colors.whitespace,
      "breadcrumb.background": palette.colors.background,
      "breadcrumb.foreground": palette.colors.foreground,
      "breadcrumb.focusForeground": palette.colors.cursor,
      "breadcrumb.activeSelectionForeground": palette.colors.cursor,
      "breadcrumbPicker.background": palette.colors.background,
      "list.activeSelectionBackground": palette.colors.selection,
      "list.activeSelectionForeground": palette.colors.foreground,
      "list.inactiveSelectionBackground": palette.colors.selection,
      "list.inactiveSelectionForeground": palette.colors.foreground,
      "list.hoverBackground": palette.colors.selection,
      "list.hoverForeground": palette.colors.foreground,
      "list.focusBackground": palette.colors.selection,
      "list.focusForeground": palette.colors.foreground,
      "list.highlightForeground": palette.colors.cursor,
      "list.errorForeground": "#ff0000",
      "list.warningForeground": "#ffcc00",
      "pickerGroup.border": palette.colors.whitespace,
      "pickerGroup.foreground": palette.colors.foreground,
      "quickInput.background": palette.colors.background,
      "quickInput.foreground": palette.colors.foreground,
      "quickInputTitle.background": palette.colors.selection,
      "input.background": palette.colors.background,
      "input.foreground": palette.colors.foreground,
      "input.border": palette.colors.whitespace,
      "input.placeholderForeground": palette.colors.whitespace,
      "inputOption.activeBackground": palette.colors.selection,
      "inputOption.activeBorder": palette.colors.cursor,
      "inputValidation.infoBackground": "#00ccff30",
      "inputValidation.infoBorder": "#00ccff",
      "inputValidation.warningBackground": "#ffcc0030",
      "inputValidation.warningBorder": "#ffcc00",
      "inputValidation.errorBackground": "#ff000030",
      "inputValidation.errorBorder": "#ff0000",
      "dropdown.background": palette.colors.background,
      "dropdown.foreground": palette.colors.foreground,
      "dropdown.border": palette.colors.whitespace,
      "button.background": palette.colors.cursor,
      "button.foreground": palette.colors.background,
      "button.hoverBackground": palette.colors.cursor,
      "button.secondaryBackground": palette.colors.selection,
      "button.secondaryForeground": palette.colors.foreground,
      "button.secondaryHoverBackground": palette.colors.selection,
      "checkbox.background": palette.colors.background,
      "checkbox.foreground": palette.colors.cursor,
      "checkbox.border": palette.colors.whitespace,
      "diffEditor.insertedTextBackground": "#00ff0030",
      "diffEditor.removedTextBackground": "#ff000030",
      "diffEditor.insertedTextBorder": "#00ff00",
      "diffEditor.removedTextBorder": "#ff0000",
      "gitDecoration.addedResourceForeground": "#00ff00",
      "gitDecoration.modifiedResourceForeground": "#ffcc00",
      "gitDecoration.deletedResourceForeground": "#ff0000",
      "gitDecoration.untrackedResourceForeground": "#00ccff",
      "gitDecoration.ignoredResourceForeground": palette.colors.whitespace,
      "gitDecoration.conflictingResourceForeground": "#ff00ff",
      "gitDecoration.submoduleResourceForeground": "#ff8800",
      "settings.headerForeground": palette.colors.foreground,
      "settings.modifiedItemIndicator": palette.colors.cursor,
      "settings.dropdownBackground": palette.colors.background,
      "settings.dropdownForeground": palette.colors.foreground,
      "settings.dropdownBorder": palette.colors.whitespace,
      "settings.checkboxBackground": palette.colors.background,
      "settings.checkboxForeground": palette.colors.cursor,
      "settings.checkboxBorder": palette.colors.whitespace,
      "settings.textInputBackground": palette.colors.background,
      "settings.textInputForeground": palette.colors.foreground,
      "settings.textInputBorder": palette.colors.whitespace,
      "settings.numberInputBackground": palette.colors.background,
      "settings.numberInputForeground": palette.colors.foreground,
      "settings.numberInputBorder": palette.colors.whitespace,
      "tab.activeBackground": palette.colors.background,
      "tab.activeForeground": palette.colors.foreground,
      "tab.inactiveBackground": `${palette.colors.background}80`,
      "tab.inactiveForeground": palette.colors.whitespace,
      "tab.border": palette.colors.whitespace,
      "tab.activeBorder": palette.colors.cursor,
      "tab.unfocusedActiveBorder": palette.colors.whitespace,
      "tab.hoverBackground": palette.colors.selection,
      "tab.unfocusedHoverBackground": palette.colors.selection,
      "tab.hoverBorder": palette.colors.cursor,
      "tab.activeModifiedBorder": palette.colors.cursor,
      "tab.inactiveModifiedBorder": palette.colors.selection,
      "editorGroupHeader.tabsBackground": palette.colors.background,
      "editorGroupHeader.tabsBorder": palette.colors.whitespace,
      "editorGroupHeader.noTabsBackground": palette.colors.background,
      "editorGroup.border": palette.colors.whitespace,
      "editorGroup.dropBackground": palette.colors.selection,
      "editorGroup.emptyBackground": palette.colors.background,
      "editorGroup.focusedEmptyBorder": palette.colors.cursor,
      "merge.currentHeaderBackground": "#00ff0030",
      "merge.incomingHeaderBackground": "#0000ff30",
      "merge.commonHeaderBackground": "#80808030",
      "merge.currentContentBackground": "#00ff0020",
      "merge.incomingContentBackground": "#0000ff20",
      "merge.commonContentBackground": "#80808020",
      "merge.border": palette.colors.whitespace,
      "markdown.codeblock.background": palette.colors.selection,
      "markdown.tableBorder": palette.colors.whitespace,
      "markdown.tableOddRowBackground": palette.colors.selection,
      "markdown.tableEvenRowBackground": palette.colors.background,
      "markdown.headingForeground": palette.colors.cursor,
      "markdown.blockquoteForeground": palette.colors.whitespace,
      "markdown.blockquoteBorder": palette.colors.cursor,
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: palette.colors.whitespace || "#808080",
          fontStyle: "italic",
        },
      },
      {
        scope: ["string", "string.template", "string.quoted", "string.regexp"],
        settings: {
          foreground: palette.colors.cursor || "#00ff00",
        },
      },
      {
        scope: ["keyword", "keyword.control", "keyword.operator"],
        settings: {
          foreground: palette.colors.selection?.replace("30", "") || "#ff00ff",
          fontStyle: "bold",
        },
      },
      {
        scope: [
          "constant",
          "constant.language",
          "constant.numeric",
          "constant.character",
        ],
        settings: {
          foreground: palette.colors.cursor || "#00ffff",
        },
      },
      {
        scope: ["variable", "variable.parameter", "variable.other"],
        settings: {
          foreground: palette.colors.foreground,
        },
      },
      {
        scope: [
          "entity.name.function",
          "entity.name.method",
          "support.function",
        ],
        settings: {
          foreground: palette.colors.cursor || "#ffcc00",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.name.class",
          "support.class",
          "storage.type",
        ],
        settings: {
          foreground: palette.colors.selection?.replace("30", "") || "#ffff00",
          fontStyle: "bold",
        },
      },
      {
        scope: ["entity.name.tag", "support.tag"],
        settings: {
          foreground: palette.colors.selection?.replace("30", "") || "#ff6699",
        },
      },
      {
        scope: ["meta.tag", "punctuation.definition.tag"],
        settings: {
          foreground: palette.colors.foreground,
        },
      },
      {
        scope: ["storage.modifier", "storage.type"],
        settings: {
          foreground: palette.colors.selection?.replace("30", "") || "#ff99cc",
        },
      },
      {
        scope: ["support.constant", "support.variable"],
        settings: {
          foreground: palette.colors.cursor || "#66ccff",
        },
      },
      {
        scope: ["invalid.illegal", "invalid.deprecated"],
        settings: {
          foreground: "#ff0000",
          fontStyle: "bold underline",
        },
      },
      {
        scope: ["entity.other.inherited-class"],
        settings: {
          foreground: palette.colors.cursor || "#66ff66",
        },
      },
      {
        scope: ["entity.name.section", "meta.separator"],
        settings: {
          foreground: palette.colors.cursor || "#ffcc00",
          fontStyle: "bold",
        },
      },
      {
        scope: ["meta.directive", "meta.preprocessor"],
        settings: {
          foreground: palette.colors.whitespace || "#999999",
        },
      },
      {
        scope: [
          "punctuation.definition.string",
          "punctuation.definition.parameters",
        ],
        settings: {
          foreground: palette.colors.foreground,
        },
      },
      {
        scope: [
          "punctuation.definition.variable",
          "punctuation.definition.entity",
        ],
        settings: {
          foreground: palette.colors.cursor || "#ff6699",
        },
      },
    ],
  };

  return JSON.stringify(theme, null, 2);
}

async function registerAllThemesInPackageJson(context) {
  const packagePath = path.join(context.extensionPath, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  if (!packageJson.contributes) {
    packageJson.contributes = {};
  }
  if (!packageJson.contributes.themes) {
    packageJson.contributes.themes = [];
  }

  for (const palette of colorPalettes) {
    const themePath = `./themes/${palette.id}.json`;
    const existingTheme = packageJson.contributes.themes.find(
      (t) => t.path === themePath,
    );

    if (!existingTheme) {
      packageJson.contributes.themes.push({
        label: `Color Palettes - ${palette.name}`,
        path: themePath,
        uiTheme: palette.category === "Light" ? "vs" : "vs-dark",
      });
    }
  }

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  outputChannel.appendLine(
    `Registered ${colorPalettes.length} themes in package.json`,
  );
}

async function ensureThemeRegistered(context, palette, themePath) {
  const packagePath = path.join(context.extensionPath, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  const themeLabel = `Color Palettes - ${palette.name}`;
  const existingTheme = packageJson.contributes?.themes?.find(
    (t) => t.label === themeLabel,
  );

  if (!existingTheme) {
    if (!packageJson.contributes) packageJson.contributes = {};
    if (!packageJson.contributes.themes) packageJson.contributes.themes = [];

    packageJson.contributes.themes.push({
      label: themeLabel,
      path: `./themes/${palette.id}.json`,
      uiTheme: palette.category === "Light" ? "vs" : "vs-dark",
    });

    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
    outputChannel.appendLine(
      `Registered theme ${palette.name} in package.json`,
    );
  }
}

async function applyThemeColors(palette) {
  const config = vscode.workspace.getConfiguration();
  const currentCustomizations =
    config.get("workbench.colorCustomizations") || {};

  const colorCustomizations = {
    ...currentCustomizations,
    "editor.background": palette.colors.background,
    "editor.foreground": palette.colors.foreground,
    "editor.selectionBackground": palette.colors.selection,
    "editor.lineHighlightBackground": palette.colors.lineHighlight,
    "editorCursor.foreground": palette.colors.cursor,
    "editorWhitespace.foreground": palette.colors.whitespace,
    "activityBar.background": palette.colors.background,
    "sideBar.background": palette.colors.background,
    "statusBar.background": palette.colors.background,
    "titleBar.activeBackground": palette.colors.background,
    "terminal.background": palette.colors.background,
    "terminal.foreground": palette.colors.foreground,
    "terminalCursor.foreground": palette.colors.cursor,
  };

  await config.update(
    "workbench.colorCustomizations",
    colorCustomizations,
    vscode.ConfigurationTarget.Global,
  );
  outputChannel.appendLine(`Applied color customizations for ${palette.name}`);
}

async function finalizeThemeApplication(palette) {
  const themeName = `Color Palettes - ${palette.name}`;
  const config = vscode.workspace.getConfiguration();

  await new Promise((resolve) => setTimeout(resolve, 200));

  await config.update(
    "workbench.colorTheme",
    themeName,
    vscode.ConfigurationTarget.Global,
  );
  outputChannel.appendLine(`Set color theme to: ${themeName}`);

  await animateThemeTransition();
}

async function animateThemeTransition() {
  if (decorationTimeout) {
    clearTimeout(decorationTimeout);
  }

  const config = vscode.workspace.getConfiguration();
  const animationSpeed = config.get("colorPalettes.animationSpeed", 300);

  decorationTimeout = setTimeout(() => {
    outputChannel.appendLine("Theme transition completed");
  }, animationSpeed);
}

function updateStatusBar(palette) {
  statusBarItem.text = `$(color-mode) ${palette.name}`;
  statusBarItem.tooltip = `Current: ${palette.name}\n${palette.description}\nClick to open Color Palettes`;
  statusBarItem.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.prominentBackground",
  );
}

function showColorPreviewNotification(palette) {
  const previewColors = Object.values(palette.preview).slice(0, 3);
  const previewText = previewColors.map((c) => `⬤`).join(" ");

  vscode.window
    .showInformationMessage(
      `${previewText} ${palette.name} active`,
      "Undo",
      "Show All",
    )
    .then((selection) => {
      if (selection === "Undo") {
        vscode.commands.executeCommand("colorPalettes.resetToDefault");
      } else if (selection === "Show All") {
        vscode.commands.executeCommand("colorPalettes.openView");
      }
    });
}

function logThemeUsage(palette) {
  const logPath = path.join(__dirname, "theme_usage.log");
  const logEntry = `${new Date().toISOString()} | Applied: ${palette.name} | Category: ${palette.category}\n`;

  fs.appendFile(logPath, logEntry, (err) => {
    if (err) {
      outputChannel.appendLine(`Failed to write usage log: ${err.message}`);
    } else {
      outputChannel.appendLine(`Logged theme usage for ${palette.name}`);
    }
  });
}

function getAllPalettes() {
  return colorPalettes;
}

function deactivate() {
  if (outputChannel) {
    outputChannel.appendLine("Extension deactivating...");
    outputChannel.dispose();
  }

  if (statusBarItem) {
    statusBarItem.dispose();
  }

  if (decorationTimeout) {
    clearTimeout(decorationTimeout);
  }

  console.log("Color Palettes extension deactivated");
}

module.exports = { activate, deactivate };
