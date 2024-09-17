![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/puj/ts-extended-deprecation-plugin/main.yml)
[![NPM Version](https://img.shields.io/npm/v/ts-extended-deprecation-plugin)](https://www.npmjs.com/package/ts-extended-deprecation-plugin)
[![NPM Downloads](https://img.shields.io/npm/dm/ts-extended-deprecation-plugin)](https://www.npmjs.com/package/ts-extended-deprecation-plugin)

<div align="center">
  <a href="https://github.com/puj/ts-extended-deprecation-plugin">
    <img width="200" height="200"
      src="https://github.com/user-attachments/assets/6a26e4c0-3869-4f6c-ae50-366ac13dae2c">
  </a>
  <h1>TS Extended Deprecation Plugin</h1>
  <p>A TypeScript Language Service Plugin for detecting and highlighting deprecated symbols in TypeScript and JavaScript projects.</p>
</div>

<div align="center">
  <!-- Place for GIF demo -->
  <img src="path/to/your/demo.gif" alt="Demo" width="600" />
</div>

### Example Output

![deprecatedBefore](https://github.com/user-attachments/assets/3f8a714d-0d22-4cea-b1fd-5d2369bd2846)

![deprecatedAfter](https://github.com/user-attachments/assets/bf2a5ebe-1b53-483f-8ab5-6310a15f2e29)

## Usage

### Installation

You can install `ts-extended-deprecation-plugin` as an npm package:

```bash
# Install the package locally
npm install --save-dev ts-extended-deprecation-plugin
```

Or with Yarn:

```bash
yarn add -D ts-extended-deprecation-plugin
```

**Note:** If you're using Visual Studio Code, you'll have to use the first approach above, with a path to the module, or run the "TypeScript: Select TypeScript Version" command and choose "Use Workspace Version", or click the version number between "TypeScript" and 😃 in the lower-right corner. Otherwise, VS Code will not be able to find your plugin. See https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin#testing-locally

### Configuration

To use this plugin in your TypeScript project, add it to your `tsconfig.json`:

```json
{
    "compilerOptions": {
        "plugins": [
            {
                "name": "ts-extended-deprecation-plugin"
            }
        ]
    }
}
```

This configuration will enable the plugin and allow it to detect deprecated symbols in your TypeScript/JavaScript code.

### How it Works

The `ts-extended-deprecation-plugin` hooks into the TypeScript Language Service, detecting any symbols marked with `@deprecated` in your project. When it finds a deprecated symbol, it does the following:

1. **Hover Tooltip**: Displays a hover tooltip in your editor with a deprecation message.
2. **Diagnostics**: Adds a warning to the diagnostics view with details about the deprecated symbol, file, and location.

### Plugin Options

You can extend the functionality with custom options in `tsconfig.json`. Currently, this plugin works automatically without additional configurations, but future releases may allow more granular control over the behavior.

### Example Scenario

Consider this code:

```typescript
// In your file.ts
/**
 * @deprecated Use newFunction instead
 */
export function oldFunction() {
    // ...
}

// Usage in another file
import { oldFunction } from "./file";
oldFunction(); // <-- Hovering over this will display a deprecation warning
```

The plugin will display a strikethrough in your editor and provide a tooltip indicating that `oldFunction` is deprecated.

### Performance Insights

The plugin is lightweight and integrates seamlessly with the TypeScript compiler, so it won’t impact performance noticeably, even in large projects.

## Major Use Cases

-   **Tracking Deprecated Code**: Identify deprecated functions, classes, variables, and more in your project and ensure your codebase remains up to date.
-   **Maintaining Code Quality**: Warn developers about deprecated code and encourage the use of newer alternatives.
-   **Cross-File Detection**: Works across multiple files in large codebases, even when deprecated symbols are re-exported or aliased.

## Troubleshooting

### Why isn’t the plugin detecting deprecated symbols?

Ensure the following:

1. The plugin is added to your `tsconfig.json` under `compilerOptions.plugins`.
2. The symbol is marked with `@deprecated` in a comment right before the declaration.

### How to view more details about deprecated symbols?

Warnings about deprecated symbols will appear in the diagnostics view in your IDE (such as VSCode). Hovering over the symbol will display the deprecation message in a tooltip.

## Support the Developer

If you find this plugin useful, consider supporting its development:

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/puj_codes)

## Maintainers

<table>
  <tbody>
    <tr>
      <td align="center">
        <img width="150" height="150"
        src="https://avatars.githubusercontent.com/u/807352?v=4&size=64">
        </br>
        <a href="https://github.com/pu">puj</a>
      </td>
    </tr>
  <tbody>
</table>

## Contributing

We welcome contributions to `ts-extended-deprecation-plugin`! Please see [CONTRIBUTING.md](https://github.com/puj/ts-extended-deprecation-plugin/blob/master/CONTRIBUTING.md) for more details.
