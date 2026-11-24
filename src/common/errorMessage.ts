// The message of a caught error, for showing to the user;
// a thrown value that is no Error reads as the fallback, or as itself when there is none.
export function errorMessage(error: unknown, fallback?: string): string {
    if (error instanceof Error) {
        return error.message;
    }

    return fallback ?? String(error);
}

// Where a parser stopped, counting lines and columns from 1.
export interface ParseErrorAt {
    readonly message: string;
    readonly line: number;
    readonly column: number;
}

// Why a text can't be read in a format, such as `Not valid JSON: Unexpected token (line 3, column 7).`;
// `subject` leads it, such as `Document is` in the views that read the open document.
export function notValidMessage(formatName: string, error: ParseErrorAt, subject?: string): string {
    const lead = subject == null ? 'Not valid' : `${subject} not valid`;

    return `${lead} ${formatName}: ${error.message} (line ${error.line}, column ${error.column}).`;
}
