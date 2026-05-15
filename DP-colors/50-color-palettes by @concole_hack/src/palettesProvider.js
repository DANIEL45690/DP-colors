// src/palettesProvider.js
const vscode = require("vscode");
const { colorPalettes } = require("./palettes");

class ColorPalettesProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      const categories = this.groupByCategory();
      return categories.map(
        (cat) => new CategoryItem(cat.name, cat.palettes, cat.icon),
      );
    }

    if (element instanceof CategoryItem && element.palettes) {
      return element.palettes.map((palette) => new PaletteItem(palette));
    }

    return [];
  }

  groupByCategory() {
    const categories = new Map();

    colorPalettes.forEach((palette) => {
      const category = palette.category || "General";
      if (!categories.has(category)) {
        categories.set(category, {
          name: category,
          palettes: [],
          icon: this.getCategoryIcon(category),
        });
      }
      categories.get(category).palettes.push(palette);
    });

    return Array.from(categories.values());
  }

  getCategoryIcon(category) {
    const icons = {
      Dark: "symbol-namespace",
      Light: "symbol-lightbulb",
      Pastel: "symbol-color",
      Vibrant: "symbol-rainbow",
      Neon: "symbol-flame",
      Minimal: "symbol-clear",
      Nature: "symbol-tree",
      Ocean: "symbol-water",
      Sunset: "symbol-sun",
      Monochrome: "symbol-greyscale",
      Retro: "symbol-clock",
      Futuristic: "symbol-sparkle",
      Professional: "symbol-briefcase",
      Creative: "symbol-palette",
    };
    return icons[category] || "symbol-color";
  }
}

class CategoryItem extends vscode.TreeItem {
  constructor(name, palettes, icon) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.name = name;
    this.palettes = palettes;
    this.contextValue = "category";
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = `${palettes.length} palettes`;
  }
}

class PaletteItem extends vscode.TreeItem {
  constructor(palette) {
    super(palette.name, vscode.TreeItemCollapsibleState.None);
    this.palette = palette;
    this.contextValue = "palette";
    this.description = palette.description;
    this.tooltip = this.createTooltip(palette);

    this.command = {
      command: "colorPalettes.applyTheme",
      title: "Apply Palette",
      arguments: [palette],
    };

    this.iconPath = new vscode.ThemeIcon("color-mode");

    this.contextValue = "palette";

    this.resourceUri = vscode.Uri.parse(`palette://${palette.id}`);
  }

  createTooltip(palette) {
    const colors = Object.values(palette.preview).slice(0, 5);
    const colorBars = colors.map((c) => `■`.repeat(10)).join(" ");
    return `${palette.name}\n${palette.description}\n\n${colorBars}`;
  }
}

module.exports = { ColorPalettesProvider };
