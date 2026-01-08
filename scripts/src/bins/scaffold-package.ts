#!/usr/bin/env node

// import { existsSync, globSync, readFileSync } from 'node:fs';
// import { mkdir, writeFile } from 'node:fs/promises';
// import { dirname, join, relative } from 'node:path/posix';
// import type { PackageJson } from '@bz/type-utils';
// import { input, select } from '@inquirer/prompts';
// import z from 'zod';
// import { PROJECT_ROOT } from '../constants.ts';
// import { checkTsconfigReferences } from '../project-infra/tsconfig.json/check-root-tsconfig-references.ts';
// import { sh } from '../utils/sh.ts';

// const TEMPLATE_WIDGET_DIR = join(PROJECT_ROOT, 'packages/widgets/template');
// const PACKAGE_ENVIRONMENTS = ['none', 'node', 'react'] as const;
// type PackageEnvironment = (typeof PACKAGE_ENVIRONMENTS)[number];

// const { packageName, packageDirectory, environment, isCreatingWidget } = await (async (): Promise<{
//   packageName: string;
//   packageDirectory: string;
//   environment: PackageEnvironment;
//   isCreatingWidget: boolean;
// }> => {
//   const packageName = await input({
//     message: 'package name (e.g. @bz/happy-birthday, @bz-fun/lol)',
//     validate: value =>
//       /^@bz(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/.test(value) ||
//       `invalid package name ${value}. package name should start with @bz and in this pattern @bz(-scope)/name`,
//   });

//   const defaultPackageDirectory = (() => {
//     const [scope, name] = z.tuple([z.string(), z.string()]).parse(packageName.split('/'));
//     if (scope === '@bz') return `packages/${name}`;
//     return `packages/${scope.replace(/^@bz-/, '')}/${name}`;
//   })();

//   if (packageName.startsWith('@bz-widgets/')) {
//     console.log(
//       `💡 You are creating a widget! Using some good defaults:

// 📁 Package Directory: ${defaultPackageDirectory}
// 🌲 Environment: browser
// 🔗 Dependencies: @bz/widget-sdk
// `,
//     );
//     return {
//       packageName,
//       packageDirectory: defaultPackageDirectory,
//       environment: 'react',
//       isCreatingWidget: true,
//     };
//   }

//   const packageDirectory = await input({
//     message: 'package path',
//     default: defaultPackageDirectory,
//   });
//   const environment = await select<PackageEnvironment>({
//     message: 'environment',
//     choices: PACKAGE_ENVIRONMENTS,
//   });
//   return {
//     packageName,
//     packageDirectory,
//     environment,
//     isCreatingWidget: false,
//   };
// })();

// if (existsSync(packageDirectory)) {
//   console.error(`Package directory already exists: ${packageDirectory}`);
//   process.exit(1);
// }

// const files = (() => {
//   const createPackageJson = (overwrite: PackageJson): PackageJson => ({
//     name: packageName,
//     private: true,
//     type: 'module',
//     // biome-ignore lint/suspicious/noExplicitAny: PackageJson is a bit too strict
//     ...(overwrite as any),
//   });

//   const createTsConfigJson = (overwrite: Record<string, unknown>): Record<string, unknown> => ({
//     compilerOptions: {
//       tsBuildInfoFile: './node_modules/.tmp/tsconfig.tsbuildinfo',
//     },
//     include: ['./src'],
//     ...overwrite,
//   });

//   const biomeConfigForceImportExtensions = {
//     $schema: relative(
//       packageDirectory,
//       join(PROJECT_ROOT, 'node_modules/@biomejs/biome/configuration_schema.json'),
//     ),
//     root: false,
//     extends: '//',
//     linter: {
//       rules: {
//         correctness: {
//           useImportExtensions: 'error',
//         },
//       },
//     },
//   };

//   const COMMON_FILES = {
//     'package.json': {
//       name: packageName,
//       private: true,
//       type: 'module',
//     } satisfies PackageJson,
//     'tsconfig.json': {
//       compilerOptions: {
//         tsBuildInfoFile: './node_modules/.tmp/tsconfig.tsbuildinfo',
//       },
//       include: ['./src'],
//     },
//   };

//   switch (environment) {
//     case 'react': {
//       if (isCreatingWidget) {
//         return Object.fromEntries(
//           globSync('**/*', {
//             cwd: TEMPLATE_WIDGET_DIR,
//             exclude: ['**/node_modules'],
//             withFileTypes: true,
//           })
//             .filter(dirent => dirent.isFile())
//             .map(dirent => join(dirent.parentPath, dirent.name))
//             .map(p => [
//               relative(TEMPLATE_WIDGET_DIR, p),
//               readFileSync(p, 'utf8').replaceAll('@bz-widgets/template', packageName),
//             ]),
//         );
//       }
//       return {
//         ...COMMON_FILES,
//         'package.json': createPackageJson({
//           main: './src/index.tsx',
//           dependencies: {
//             react: 'catalog:',
//             'react-dom': 'catalog:',
//           },
//         }),
//         'tsconfig.json': createTsConfigJson({
//           extends: relative(packageDirectory, join(PROJECT_ROOT, 'tsconfig.vite.json')),
//         }),
//         'src/index.tsx': `import { type ReactNode } from 'react';

// export const MyAwesomeComponent = (): ReactNode => <div>hello world</div>;
// `,
//       };
//     }
//     case 'none':
//       return {
//         'package.json': createPackageJson({
//           main: './src/index.ts',
//         }),
//         'tsconfig.json': createTsConfigJson({
//           extends: relative(packageDirectory, join(PROJECT_ROOT, 'tsconfig.base.json')),
//         }),
//         'src/index.ts': `console.log('hello world');\n`,
//       };
//     case 'node':
//       return {
//         'package.json': createPackageJson({
//           main: './src/index.ts',
//         }),
//         'tsconfig.json': createTsConfigJson({
//           extends: relative(packageDirectory, join(PROJECT_ROOT, 'tsconfig.node.json')),
//         }),
//         'src/index.ts': 'process.exit(1);\n',
//         'biome.json': biomeConfigForceImportExtensions,
//       };
//   }
// })();

// console.log('Scaffolding files...');

// await mkdir(packageDirectory, { recursive: true });

// await Promise.all([
//   ...Object.entries(files).map(async ([fileName, content]) => {
//     const filePath = join(packageDirectory, fileName);
//     await mkdir(dirname(filePath), { recursive: true });
//     await writeFile(
//       filePath,
//       typeof content === 'string' ? content : JSON.stringify(content),
//       'utf8',
//     );
//   }),
// ]);

// checkTsconfigReferences({ fix: true });

// console.log('✅ Scaffolding done!');

// sh('pnpm install');
// sh('pnpm check:fix');
// sh('pnpm check:fix tsconfig.json');
