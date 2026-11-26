// A heading's id: lower case, spaces as hyphens, and only letters, digits and hyphens kept, in any script.
export function headingSlug(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}
