import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'Invoke-Test.ps1');

// Windows PowerShell, which runs the script with -File, when this machine has it.
function findPowerShell() {
    for (const command of ['powershell.exe', 'pwsh']) {
        try {
            execFileSync(command, ['-NoProfile', '-NonInteractive', '-Command', '$null'], { stdio: 'ignore' });

            return command;
        }
        catch {
            // Not installed here; try the next one.
        }
    }

    return null;
}

const POWER_SHELL = findPowerShell();

// The source of one function of Invoke-Test.ps1, from its `function` line to the brace that closes it at the line start.
function functionSource(name) {
    const script = readFileSync(SCRIPT_PATH, 'utf-8').replaceAll('\r\n', '\n');
    const start = script.indexOf(`function ${name} {`);
    const end = script.indexOf('\n}\n', start);

    if (start < 0 || end < 0) {
        throw new Error(`Invoke-Test.ps1 has no function ${name}`);
    }

    return script.slice(start, end + 2);
}

// Runs the function on the PowerShell expression given as -Path, and returns each path it lists.
function convertPaths(pathExpression) {
    const command = `${functionSource('ConvertTo-TestPathList')}\nConvertTo-TestPathList -Path ${pathExpression} | ForEach-Object { "[$_]" }`;
    const output = execFileSync(POWER_SHELL ?? '', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf-8' });

    return output.split(/\r?\n/).filter((line) => line !== '');
}

describe.skipIf(POWER_SHELL == null)('Invoke-Test.ps1 ConvertTo-TestPathList', () => {
    it('splits the one string powershell.exe -File passes for -Path a,b', () => {
        expect(convertPaths(`'src/common/markdown,scripts'`)).toEqual(['[src/common/markdown]', '[scripts]']);
    });

    it('keeps a list, as -Command and other scripts pass it', () => {
        expect(convertPaths(`@('src', 'scripts')`)).toEqual(['[src]', '[scripts]']);
    });

    it('trims spaces around each path and drops empty entries', () => {
        expect(convertPaths(`@(' src , scripts,', 'docs')`)).toEqual(['[src]', '[scripts]', '[docs]']);
    });

    it('keeps a single path as it is', () => {
        expect(convertPaths(`'./src/common/markdown'`)).toEqual(['[./src/common/markdown]']);
    });
});
