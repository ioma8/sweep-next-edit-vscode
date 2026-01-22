import * as fs from "node:fs";
import * as path from "node:path";
import Mocha from "mocha";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true });
  const testsRoot = path.resolve(__dirname, ".");

  const collectTestFiles = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectTestFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
        files.push(fullPath);
      }
    }
    return files;
  };

  for (const file of collectTestFiles(testsRoot)) {
    mocha.addFile(file);
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
        return;
      }
      resolve();
    });
  });
}
