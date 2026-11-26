export type FileTypeId =
    | 'json'
    | 'xml'
    | 'csv'
    | 'excel'
    | 'word'
    | 'presentation'
    | 'opendocument'
    | 'text'
    | 'markdown'
    | 'html'
    | 'css'
    | 'javascript'
    | 'typescript'
    | 'yaml'
    | 'har'
    | 'pdf'
    | 'image'
    | 'archive'
    | 'audio'
    | 'video'
    | 'font'
    | 'folder'
    | 'unknown';

export interface FileType {
    readonly id: FileTypeId;
    readonly glyph: string;
    readonly isText: boolean;
}

// The glyph shows in the tree and on tabs; the colour comes from the theme's --ft-* tokens.
export const FILE_TYPES: ReadonlyArray<FileType> = [
    {
        id: 'json',
        glyph: '{ }',
        isText: true,
    },
    {
        id: 'xml',
        glyph: '</>',
        isText: true,
    },
    {
        id: 'csv',
        glyph: '≣',
        isText: true,
    },
    {
        id: 'excel',
        glyph: 'xl',
        isText: false,
    },
    {
        id: 'word',
        glyph: 'w',
        isText: false,
    },
    {
        id: 'presentation',
        glyph: 'pp',
        isText: false,
    },
    {
        id: 'opendocument',
        glyph: 'od',
        isText: false,
    },
    {
        id: 'text',
        glyph: '≡',
        isText: true,
    },
    {
        id: 'markdown',
        glyph: 'md',
        isText: true,
    },
    {
        id: 'html',
        glyph: '< >',
        isText: true,
    },
    {
        id: 'css',
        glyph: '#',
        isText: true,
    },
    {
        id: 'javascript',
        glyph: 'js',
        isText: true,
    },
    {
        id: 'typescript',
        glyph: 'ts',
        isText: true,
    },
    {
        id: 'yaml',
        glyph: 'yl',
        isText: true,
    },
    {
        id: 'har',
        glyph: '~',
        isText: true,
    },
    {
        id: 'pdf',
        glyph: 'pd',
        isText: false,
    },
    {
        id: 'image',
        glyph: '◭',
        isText: false,
    },
    {
        id: 'archive',
        glyph: '◰',
        isText: false,
    },
    {
        id: 'audio',
        glyph: '♪',
        isText: false,
    },
    {
        id: 'video',
        glyph: '▶',
        isText: false,
    },
    {
        id: 'font',
        glyph: 'Aa',
        isText: false,
    },
    {
        id: 'folder',
        // The Explorer draws folders with an open or closed folder icon in CSS, so the glyph stays empty.
        glyph: '',
        isText: false,
    },
    {
        id: 'unknown',
        glyph: '•',
        isText: false,
    },
];

const FILE_TYPE_BY_ID = new Map<FileTypeId, FileType>(FILE_TYPES.map((type) => [type.id, type]));

// Map of lowercase suffixes (no leading dot) to a file-type id.
// A suffix can contain dots, so `tar.gz` resolves to archive via longest-match.
export const EXTENSION_MAP: ReadonlyMap<string, FileTypeId> = new Map<string, FileTypeId>([
    ['json', 'json'],
    ['jsonc', 'json'],
    ['json5', 'json'],
    ['xml', 'xml'],
    ['xsd', 'xml'],
    ['xsl', 'xml'],
    ['xslt', 'xml'],
    ['config', 'xml'],
    ['csv', 'csv'],
    ['tsv', 'csv'],
    ['xlsx', 'excel'],
    ['xls', 'excel'],
    ['xlsm', 'excel'],
    ['xltx', 'excel'],
    ['xltm', 'excel'],
    ['xlsb', 'excel'],
    ['ods', 'excel'],
    ['docx', 'word'],
    ['docm', 'word'],
    ['dotx', 'word'],
    ['dotm', 'word'],
    ['doc', 'word'],
    ['ppt', 'presentation'],
    ['pptx', 'presentation'],
    ['pptm', 'presentation'],
    ['pps', 'presentation'],
    ['ppsx', 'presentation'],
    ['ppsm', 'presentation'],
    ['pot', 'presentation'],
    ['potx', 'presentation'],
    ['potm', 'presentation'],
    ['odp', 'presentation'],
    ['odt', 'opendocument'],
    ['odg', 'opendocument'],
    ['txt', 'text'],
    ['log', 'text'],
    ['md', 'markdown'],
    ['markdown', 'markdown'],
    ['mdx', 'markdown'],
    ['html', 'html'],
    ['htm', 'html'],
    ['css', 'css'],
    ['scss', 'css'],
    ['sass', 'css'],
    ['less', 'css'],
    ['js', 'javascript'],
    ['mjs', 'javascript'],
    ['cjs', 'javascript'],
    ['ts', 'typescript'],
    ['tsx', 'typescript'],
    ['yml', 'yaml'],
    ['yaml', 'yaml'],
    ['har', 'har'],
    ['pdf', 'pdf'],
    ['png', 'image'],
    ['apng', 'image'],
    ['jpg', 'image'],
    ['jpeg', 'image'],
    ['jfif', 'image'],
    ['pjpeg', 'image'],
    ['pjp', 'image'],
    ['gif', 'image'],
    ['svg', 'image'],
    ['webp', 'image'],
    ['avif', 'image'],
    ['bmp', 'image'],
    ['ico', 'image'],
    ['cur', 'image'],
    ['heic', 'image'],
    ['heif', 'image'],
    ['hif', 'image'],
    ['tif', 'image'],
    ['tiff', 'image'],
    ['zip', 'archive'],
    ['gz', 'archive'],
    ['tar', 'archive'],
    ['tar.gz', 'archive'],
    ['tgz', 'archive'],
    ['bz2', 'archive'],
    ['tar.bz2', 'archive'],
    ['tbz2', 'archive'],
    ['xz', 'archive'],
    ['tar.xz', 'archive'],
    ['txz', 'archive'],
    ['zst', 'archive'],
    ['tar.zst', 'archive'],
    ['7z', 'archive'],
    ['rar', 'archive'],
    ['cab', 'archive'],
    ['iso', 'archive'],
    ['mp3', 'audio'],
    ['wav', 'audio'],
    ['ogg', 'audio'],
    ['oga', 'audio'],
    ['opus', 'audio'],
    ['flac', 'audio'],
    ['m4a', 'audio'],
    ['aac', 'audio'],
    ['weba', 'audio'],
    ['mp4', 'video'],
    ['m4v', 'video'],
    ['webm', 'video'],
    ['ogv', 'video'],
    ['mov', 'video'],
    ['mkv', 'video'],
    ['woff', 'font'],
    ['woff2', 'font'],
    ['ttf', 'font'],
    ['otf', 'font'],
    ['ttc', 'font'],
    ['otc', 'font'],
]);

// The Type of a file in Info and the status bar,
// for the kinds a type holds that its name alone doesn't tell apart.
const TYPE_LABELS: ReadonlyMap<string, string> = new Map([
    ['xlsx', 'Excel workbook'],
    ['xls', 'Excel 97–2003 workbook'],
    ['xlsm', 'Excel macro-enabled workbook'],
    ['xltx', 'Excel template'],
    ['xltm', 'Excel macro-enabled template'],
    ['xlsb', 'Excel binary workbook'],
    ['ods', 'OpenDocument spreadsheet'],
    ['pptx', 'PowerPoint presentation'],
    ['pptm', 'PowerPoint macro-enabled presentation'],
    ['ppt', 'PowerPoint 97–2003 presentation'],
    ['ppsx', 'PowerPoint slide show'],
    ['ppsm', 'PowerPoint macro-enabled slide show'],
    ['pps', 'PowerPoint 97–2003 slide show'],
    ['potx', 'PowerPoint template'],
    ['potm', 'PowerPoint macro-enabled template'],
    ['pot', 'PowerPoint 97–2003 template'],
    ['odp', 'OpenDocument presentation'],
    ['odt', 'OpenDocument text document'],
    ['odg', 'OpenDocument drawing'],
]);

// Sorted longest first so `.tar.gz` wins over `.gz` during resolution.
const SORTED_SUFFIXES: ReadonlyArray<readonly [string, FileTypeId]> = Array.from(EXTENSION_MAP.entries())
    .sort((left, right) => right[0].length - left[0].length);

function fileTypeById(id: FileTypeId): FileType {
    const type = FILE_TYPE_BY_ID.get(id);

    if (type == null) {
        throw new Error(`Unknown file type id: ${id}`);
    }

    return type;
}

// The longest known suffix of a file name, lowercased, such as `tar.gz`; null when none matches.
// Dotfiles (e.g. ".gitignore") and extensionless names have none.
export function matchFileSuffix(name: string): string | null {
    const lower = name.toLowerCase();
    const match = SORTED_SUFFIXES.find(([suffix]) => lower.endsWith(`.${suffix}`) && lower.length > suffix.length + 1);

    return match?.[0] ?? null;
}

// Resolves a file name to a FileType by its longest known suffix; a name without one is the `unknown` type.
export function resolveFileType(name: string): FileType {
    const suffix = matchFileSuffix(name);

    return fileTypeById(EXTENSION_MAP.get(suffix ?? '') ?? 'unknown');
}

// "OpenDocument spreadsheet", "PowerPoint presentation": what kind of workbook,
// presentation or OpenDocument file a name is; null for the other types.
export function fileTypeLabel(name: string): string | null {
    return TYPE_LABELS.get(matchFileSuffix(name) ?? '') ?? null;
}
