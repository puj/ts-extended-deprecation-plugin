import * as ts from "typescript";
import { Project } from "ts-morph";
import { getSymbolAtNode, isSymbolDeprecated } from "../src/utils";
import { resolve } from "path";
import * as fs from "fs";
import path = require("path");
const init = require("../src");

describe("Deprecation Plugin Tests", () => {
    // Test the file type check
    // test("isSupportedFileType correctly identifies TypeScript/JavaScript files", () => {
    //     const isSupportedFileType = fileName => {
    //         return (
    //             fileName.endsWith(".ts") ||
    //             fileName.endsWith(".tsx") ||
    //             fileName.endsWith(".js") ||
    //             fileName.endsWith(".jsx")
    //         );
    //     };

    //     expect(isSupportedFileType("file.ts")).toBe(true);
    //     expect(isSupportedFileType("file.tsx")).toBe(true);
    //     expect(isSupportedFileType("file.js")).toBe(true);
    //     expect(isSupportedFileType("file.jsx")).toBe(true);
    //     expect(isSupportedFileType("file.txt")).toBe(false);
    // });

    // test("Correctly finds deprecated symbols in JSDoc", () => {
    //     // Mock TypeScript source code and initialize the program
    //     const sourceCode = `
    //         /**
    //          * @deprecated Use newFunction instead
    //          */
    //         function oldFunction() {}
    //     `;

    //     // Create a source file
    //     const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.ES2015, true);

    //     // Initialize TypeScript program and checker
    //     const compilerOptions = {
    //         noResolve: true,
    //         noEmit: true,
    //         target: ts.ScriptTarget.ES2015
    //     };

    //     // Create a custom compiler host
    //     const compilerHost = ts.createCompilerHost(compilerOptions);
    //     compilerHost.getSourceFile = (fileName, languageVersion) => {
    //         if (fileName === "test.ts") {
    //             return sourceFile;
    //         }
    //         // For any other file, return undefined or throw an error
    //         return undefined;
    //     };

    //     // Create the program with the custom host
    //     const program = ts.createProgram(["test.ts"], compilerOptions, compilerHost);

    //     // Get the type checker
    //     const checker = program.getTypeChecker();

    //     // Traverse the source file and retrieve the symbol for `oldFunction`
    //     let foundDeprecated = false;

    //     const visit = node => {
    //         if (ts.isFunctionDeclaration(node)) {
    //             const symbol = getSymbolAtNode(checker, node);
    //             if (symbol) {
    //                 if (isSymbolDeprecated(symbol)) {
    //                     foundDeprecated = true;
    //                 }
    //             }
    //         }
    //         ts.forEachChild(node, visit);
    //     };

    //     visit(sourceFile);

    //     // Expect the deprecated symbol to be found
    //     expect(foundDeprecated).toBe(true);
    // });

    // test("Correctly finds deprecated symbols in TypeScript comments", () => {
    //     // Mock TypeScript source code and initialize the program
    //     const sourceCode = `
    //         // @deprecated Use newFunction instead
    //         function oldFunction() {}
    //     `;

    //     // Create a source file
    //     const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.ES2015, true);

    //     // Initialize TypeScript program and checker
    //     const compilerOptions = {
    //         noResolve: true,
    //         noEmit: true,
    //         target: ts.ScriptTarget.ES2015
    //     };

    //     // Create a custom compiler host
    //     const compilerHost = ts.createCompilerHost(compilerOptions);
    //     compilerHost.getSourceFile = (fileName, languageVersion) => {
    //         if (fileName === "test.ts") {
    //             return sourceFile;
    //         }
    //         // For any other file, return undefined or throw an error
    //         return undefined;
    //     };

    //     // Create the program with the custom host
    //     const program = ts.createProgram(["test.ts"], compilerOptions, compilerHost);

    //     // Get the type checker
    //     const checker = program.getTypeChecker();

    //     // Traverse the source file and retrieve the symbol for `oldFunction`
    //     let foundDeprecated = false;

    //     const visit = node => {
    //         if (ts.isFunctionDeclaration(node)) {
    //             const symbol = getSymbolAtNode(checker, node);
    //             if (isSymbolDeprecated(symbol)) {
    //                 foundDeprecated = true;
    //             }
    //         }
    //         ts.forEachChild(node, visit);
    //     };

    //     visit(sourceFile);

    //     // Expect the deprecated symbol to be found
    //     expect(foundDeprecated).toBe(true);
    // });

    // test("Plugin properly initializes and logs deprecated symbols", () => {
    //     const mockLogger = { info: jest.fn() };
    //     // const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);
    //     const mockInfo = {
    //         project: {
    //             projectService: {
    //                 logger: mockLogger
    //             }
    //         },
    //         languageService: {
    //             getProgram: jest.fn().mockReturnValue({
    //                 getTypeChecker: jest.fn().mockReturnValue({
    //                     getSymbolAtLocation: jest.fn().mockReturnValue({
    //                         getName: jest.fn().mockReturnValue("oldFunction"),
    //                         getDeclarations: jest.fn().mockReturnValue([
    //                             {
    //                                 getStart: jest.fn().mockReturnValue(0),
    //                                 getEnd: jest.fn().mockReturnValue(10)
    //                             }
    //                         ])
    //                     })
    //                 }),
    //                 getSourceFile: jest.fn().mockReturnValue({
    //                     statements: [
    //                         {
    //                             name: { text: "oldFunction" },
    //                             getStart: jest.fn().mockReturnValue(0),
    //                             getEnd: jest.fn().mockReturnValue(10)
    //                             // getSourceFile: jest.fn().mockReturnValue(sourceFile) // Provide the sourceFile here
    //                         }
    //                     ]
    //                 })
    //             }),
    //             getSemanticDiagnostics: jest.fn().mockReturnValue([])
    //         }
    //     };

    //     const plugin = init({ typescript: ts }).create(mockInfo);
    //     console.log(plugin);

    //     const diagnostics = plugin.getSemanticDiagnostics("test.ts");
    //     expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("[DEPRECATION PLUGIN]"));
    // });

    // Compile the typescript project at ./tests/chain-texts/tsconfig.test.json
    test("Plugin properly initializes and logs deprecated symbols", () => {
        const configPath = path.resolve(__dirname, "./tsconfig.test.json");
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        const parsedCommandLine = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));

        const compilerOptions = parsedCommandLine.options;

        const servicesHost = {
            getScriptFileNames: () => parsedCommandLine.fileNames,
            getScriptVersion: fileName => "1",
            getScriptSnapshot: fileName => {
                if (fs.existsSync(fileName)) {
                    return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
                }
                return undefined;
            },
            getCurrentDirectory: () => process.cwd(),
            getCompilationSettings: () => compilerOptions,
            getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            directoryExists: ts.sys.directoryExists,
            getDirectories: ts.sys.getDirectories
        };

        // Create the language service
        const languageService = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());

        // Load your plugin
        const pluginModulePath = path.resolve(__dirname, "../dist/index.js");
        const pluginModule = require(pluginModulePath);
        const pluginFactory = pluginModule({ typescript: ts });

        // Mock the 'info' object expected by the plugin's 'create' method
        const info = {
            languageService,
            languageServiceHost: servicesHost,
            project: {
                projectService: {
                    logger: {
                        info: msg => console.log(msg)
                    }
                },
                getCompilerOptions: () => compilerOptions
            },
            config: configFile.config
            // Add any other properties your plugin might need
        };

        // Apply the plugin to the language service
        const enhancedLanguageService = pluginFactory.create(info);

        // Use the enhanced language service
        const targetFile = path.resolve(__dirname, "./chain-test/index.ts");
        const diagnostics = enhancedLanguageService.getSemanticDiagnostics(targetFile);
        console.log(diagnostics);
    });
});
