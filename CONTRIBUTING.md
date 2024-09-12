# Contributing to TS Extended Deprecation Plugin

Thank you for your interest in contributing to TS Extended Deprecation Plugin! We appreciate your support and contributions to make this tool better for everyone.

## Getting Started

### Prerequisites

Ensure you have the following installed:

-   [Node.js](https://nodejs.org/) (version 16.x or higher recommended)
-   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/puj/ts-extended-deprecation-plugin.git
    cd ts-extended-deprecation-plugin
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

    or if using Yarn:

    ```bash
    yarn install
    ```

### Development Workflow

1. **Make changes** in the `src/` folder or other relevant files as needed.

2. **Compile the plugin**:

    If your changes are in TypeScript, compile the TypeScript source code to JavaScript using:

    ```bash
    npm run build
    ```

    or if using Yarn:

    ```bash
    yarn build
    ```

3. **Test your changes**:

    You can run tests using Jest. Make sure your changes are covered with relevant tests:

    ```bash
    npm run test
    ```

    or:

    ```bash
    yarn test
    ```

4. **Use the plugin locally**:

    If you want to test the plugin in a TypeScript project, you can link the plugin globally:

    ```bash
    npm link
    ```

    Then, in your TypeScript project, use:

    ```bash
    npm link ts-extended-deprecation-plugin
    ```

    This will allow you to test the plugin locally in another project.

### Submitting Changes

1. **Create a branch** for your changes:

    ```bash
    git checkout -b your-feature-branch
    ```

2. **Commit your changes** with a clear message:

    ```bash
    git commit -m "Description of your changes"
    ```

3. **Push to the branch**:

    ```bash
    git push origin your-feature-branch
    ```

4. **Open a Pull Request**: Navigate to the repository on GitHub and create a new pull request.

### Code Guidelines

-   Follow best practices for JavaScript/TypeScript code and ensure your code is well-documented.
-   Run `npm run lint` or `yarn lint` to check for any linting issues.
-   Write clear, concise commit messages that describe the changes made.

### Reporting Issues

If you encounter any issues or have suggestions for improvements, please create an issue on GitHub.

---

Thank you for contributing!
