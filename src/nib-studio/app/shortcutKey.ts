// The letter of a Ctrl shortcut as an English layout gives it. With a second layout such as Greek,
// Ctrl+σ carries the key 'σ' and the code 'KeyS', and Chrome runs its own shortcuts by the key's place,
// so the studio reads the place too whenever the key isn't a Latin letter.
export function shortcutLetter(event: KeyboardEvent): string {
    const key = event.key.toLowerCase();

    if (/^[a-z]$/.test(key)) {
        return key;
    }

    const match = /^Key([A-Z])$/.exec(event.code);

    return match?.[1]?.toLowerCase() ?? key;
}
