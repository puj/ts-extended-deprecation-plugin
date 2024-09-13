import * as ts from "typescript";
import { Project } from "ts-morph";
import { isSymbolDeprecated } from "./utils";
const init = require("./");

describe("Deprecation Plugin Tests", () => {
    // Test the file type check
    test("isSupportedFileType correctly identifies TypeScript/JavaScript files", () => {
        const isSupportedFileType = fileName => {
            return (
                fileName.endsWith(".ts") ||
                fileName.endsWith(".tsx") ||
                fileName.endsWith(".js") ||
                fileName.endsWith(".jsx")
            );
        };

        expect(isSupportedFileType("file.ts")).toBe(true);
        expect(isSupportedFileType("file.tsx")).toBe(true);
        expect(isSupportedFileType("file.js")).toBe(true);
        expect(isSupportedFileType("file.jsx")).toBe(true);
        expect(isSupportedFileType("file.txt")).toBe(false);
    });

    // Helper function to retrieve the symbol at a node
    const getSymbolAtNode = (checker, node) => {
        const symbol = checker.getSymbolAtLocation(node.name);
        return symbol;
    };

    test("Correctly finds deprecated symbols in JSDoc", () => {
        // Mock TypeScript source code and initialize the program
        const sourceCode = `
            /**
             * @deprecated Use newFunction instead
             */
            function oldFunction() {}
        `;

        // Create a source file
        const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.ES2015, true);

        // Initialize TypeScript program and checker
        const compilerOptions = {
            noResolve: true,
            noEmit: true,
            target: ts.ScriptTarget.ES2015
        };

        // Create a custom compiler host
        const compilerHost = ts.createCompilerHost(compilerOptions);
        compilerHost.getSourceFile = (fileName, languageVersion) => {
            if (fileName === "test.ts") {
                return sourceFile;
            }
            // For any other file, return undefined or throw an error
            return undefined;
        };

        // Create the program with the custom host
        const program = ts.createProgram(["test.ts"], compilerOptions, compilerHost);

        // Get the type checker
        const checker = program.getTypeChecker();

        // Traverse the source file and retrieve the symbol for `oldFunction`
        let foundDeprecated = false;

        const visit = node => {
            if (ts.isFunctionDeclaration(node)) {
                const symbol = getSymbolAtNode(checker, node);
                if (symbol) {
                    if (isSymbolDeprecated(symbol, checker, node)) {
                        foundDeprecated = true;
                    }
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        // Expect the deprecated symbol to be found
        expect(foundDeprecated).toBe(true);
    });

    test("Correctly finds deprecated symbols in TypeScript comments", () => {
        // Mock TypeScript source code and initialize the program
        const sourceCode = `
            // @deprecated Use newFunction instead
            function oldFunction() {}
        `;

        // Create a source file
        const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.ES2015, true);

        // Initialize TypeScript program and checker
        const compilerOptions = {
            noResolve: true,
            noEmit: true,
            target: ts.ScriptTarget.ES2015
        };

        // Create a custom compiler host
        const compilerHost = ts.createCompilerHost(compilerOptions);
        compilerHost.getSourceFile = (fileName, languageVersion) => {
            if (fileName === "test.ts") {
                return sourceFile;
            }
            // For any other file, return undefined or throw an error
            return undefined;
        };

        // Create the program with the custom host
        const program = ts.createProgram(["test.ts"], compilerOptions, compilerHost);

        // Get the type checker
        const checker = program.getTypeChecker();

        // Traverse the source file and retrieve the symbol for `oldFunction`
        let foundDeprecated = false;

        const visit = node => {
            if (ts.isFunctionDeclaration(node)) {
                const symbol = getSymbolAtNode(checker, node);
                if (isSymbolDeprecated(symbol, checker, node)) {
                    foundDeprecated = true;
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        // Expect the deprecated symbol to be found
        expect(foundDeprecated).toBe(true);
    });

    test("Plugin properly initializes and logs deprecated symbols", () => {
        const mockLogger = { info: jest.fn() };
        const mockInfo = {
            project: {
                projectService: {
                    logger: mockLogger
                }
            },
            languageService: {
                getProgram: jest.fn().mockReturnValue({
                    getTypeChecker: jest.fn().mockReturnValue({
                        getSymbolAtLocation: jest.fn().mockReturnValue({
                            getName: jest.fn().mockReturnValue("oldFunction"),
                            getDeclarations: jest.fn().mockReturnValue([
                                {
                                    getStart: jest.fn().mockReturnValue(0),
                                    getEnd: jest.fn().mockReturnValue(10)
                                }
                            ])
                        })
                    }),
                    getSourceFile: jest.fn().mockReturnValue({
                        statements: [
                            {
                                name: { text: "oldFunction" },
                                getStart: jest.fn().mockReturnValue(0),
                                getEnd: jest.fn().mockReturnValue(10)
                            }
                        ]
                    })
                }),
                getSemanticDiagnostics: jest.fn().mockReturnValue([])
            }
        };

        const plugin = init({ typescript: ts }).create(mockInfo);
        console.log(plugin);

        const diagnostics = plugin.getSemanticDiagnostics("test.ts");
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("[DEPRECATION PLUGIN]"));
    });
});

// Helper functions
const getPrecedingComments = (declaration, node) => {
    const sourceFile = node.getSourceFile();
    const fullText = sourceFile.getFullText();
    const comments = [];

    // Get the position of the declaration
    const leadingCommentRanges = ts.getLeadingCommentRanges(fullText, declaration.getFullStart()) || [];
    leadingCommentRanges.forEach(range => {
        const comment = fullText.substring(range.pos, range.end);
        comments.push(comment);
    });

    return comments;
};
