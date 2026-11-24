export interface HtmlExportOptions {
    readonly title: string;
    readonly bodyHtml: string;
    readonly accentColor?: string;
}

export function buildStandaloneHtml(options: HtmlExportOptions): string {
    const accent = options.accentColor ?? '#1f6feb';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
    <style>
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            font: 15px/1.6 "Segoe UI", system-ui, -apple-system, sans-serif;
            color: #0f172a;
            background: #ffffff;
            padding: 40px;
            max-width: 820px;
            margin: 0 auto;
        }
        h1, h2, h3 { color: #0f172a; }
        h1 { border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
        a { color: ${accent}; }
        code {
            background: #eef1f5;
            padding: 1px 6px;
            border-radius: 4px;
            font: 13px/1.5 "Cascadia Mono", Consolas, monospace;
        }
        pre {
            background: #eef1f5;
            padding: 12px 14px;
            border-radius: 6px;
            overflow-x: auto;
        }
        pre code { background: transparent; padding: 0; }
        blockquote {
            margin: 0 0 10px;
            padding: 4px 12px;
            border-left: 3px solid ${accent};
            color: #475569;
        }
        table { border-collapse: collapse; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 10px; }
        th { background: #eef1f5; }
        .md-mermaid svg { max-width: 100%; height: auto; }
        img { max-width: 100%; height: auto; }
        kbd {
            padding: 1px 5px;
            border: 1px solid #cbd5e1;
            border-bottom-width: 2px;
            border-radius: 4px;
            font: 12px "Cascadia Mono", Consolas, monospace;
        }
        .md-image-blocked {
            display: inline-block;
            padding: 4px 8px;
            border: 1px dashed #cbd5e1;
            border-radius: 6px;
            color: #475569;
            font-size: 12px;
        }
    </style>
</head>
<body>
${options.bodyHtml}
</body>
</html>`;
}

export function downloadHtml(filename: string, html: string): void {
    downloadFile(filename, html, 'text/html;charset=utf-8');
}

// Saves text as a file in the browser's downloads, through a blob and a temporary download link.
export function downloadFile(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
