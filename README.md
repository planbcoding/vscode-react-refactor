This simple extension provides refactor code actions for React developers.

Recompose your overgrown JSX without worrying about the given data. This extension will do the dirty work for you without breaking your code.

## Features

-   Extract JSX element to file or function
-   Supports TypeScript and TSX
-   Works with classes, functions and arrow functions
-   Handles key attribute and function bindings
-   Works well with new Hooks API

## Preview

![preview](assets/images/preview.gif)

## Concept

The `Extract to file` function uses the `Move to new file` refactor code action provided by the TS Language Service. This makes sure that the necessary dependencies shall be moved to the new file and the local dependencies shall be exported as well. The result is so satisfying using TS Language Service, no need for re-implementing such features those are already developed and work well - obviously with some corresponding modifications done. As TypeScript prefers named exports to default exports so this is a limitation of the extension.

After refactoring the code, the extension runs a code formatting which will be done through the default code formatter of your VSCode instance. For the best result it is recommended to use Prettier extension that supports fix self closing tags, long lines etc..

## Reporting bugs

If something doesn't work don't panic. As this is an early version of the code it is also possible that you found a bug. Please don't hesitate to open a github issue (with specific code example) if you face any anomalies.
