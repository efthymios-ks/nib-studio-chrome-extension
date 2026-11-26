import { describe, expect, it } from 'vitest';
import { detectTextFormat, TEXT_FORMAT_EXTENSIONS } from './textFormat.js';

describe('detectTextFormat', () => {
    it('takes an object or an array that parses as JSON as JSON', () => {
        expect(detectTextFormat('{"name":"nib","tags":["a","b"]}')).toBe('json');
        expect(detectTextFormat('[\r\n  1,\r\n  2\r\n]\r\n')).toBe('json');
        expect(detectTextFormat('  {}  ')).toBe('json');
    });

    it('takes a bare JSON value, or JSON with a mistake, as something else', () => {
        expect(detectTextFormat('42')).toBe('text');
        expect(detectTextFormat('"quoted"')).toBe('text');
        expect(detectTextFormat('true')).toBe('text');
        expect(detectTextFormat('{"name": "nib",}')).toBe('text');
    });

    it('takes a page or a fragment of HTML elements as HTML', () => {
        expect(detectTextFormat('<!DOCTYPE html>\n<html><head><title>Hi</title></head><body><p>Hi</p></body></html>')).toBe('html');
        expect(detectTextFormat('<html lang="en"><body>Hi</body></html>')).toBe('html');
        expect(detectTextFormat('<!-- Banner -->\n<div class="card"><p>Hello<br>world</p></div>\n')).toBe('html');
        expect(detectTextFormat('<table><tr><td>1</td></tr></table>')).toBe('html');
    });

    it('takes well-formed XML that isn\'t HTML as XML', () => {
        expect(detectTextFormat('<?xml version="1.0"?>\n<orders><order id="1"/></orders>')).toBe('xml');
        expect(detectTextFormat('<feed><item>1</item></feed>')).toBe('xml');
        expect(detectTextFormat('<a><b>1</b></a>')).toBe('xml');
        expect(detectTextFormat('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')).toBe('xml');
    });

    it('takes markup that isn\'t well formed, or a component tag, as something else', () => {
        expect(detectTextFormat('<feed><item>1</feed>')).toBe('text');
        expect(detectTextFormat('<Button onClick={save}>Save</Button>')).toBe('text');
        expect(detectTextFormat('<br> starts this line')).toBe('text');
    });

    it('takes mappings and lists of mappings as YAML', () => {
        expect(detectTextFormat('name: demo\nserver:\n  host: localhost\n  port: 80\n')).toBe('yaml');
        expect(detectTextFormat('# Settings\nname: demo\nlevel: 2\n')).toBe('yaml');
        expect(detectTextFormat('- name: a\n  value: 1\n- name: b\n  value: 2\n')).toBe('yaml');
        expect(detectTextFormat('---\nfirst: 1\nsecond: 2\n---\nthird: 3\nfourth: 4\n')).toBe('yaml');
    });

    it('takes a sentence, a single key, a stack trace or a plain list as something other than YAML', () => {
        expect(detectTextFormat('Hello world, this is a sentence.')).toBe('text');
        expect(detectTextFormat('Note: call the office before noon.')).toBe('text');
        expect(detectTextFormat('Error: something failed\n    at run (main.js:10:5)\n')).toBe('text');
        expect(detectTextFormat('Dear Ann:\nThank you for the parcel.\n')).toBe('text');
        expect(detectTextFormat('- milk\n- eggs\n- bread\n')).toBe('text');
        expect(detectTextFormat('key: [unclosed\nother: 1\n')).toBe('text');
    });

    it('takes rows with the same number of tabs as TSV', () => {
        expect(detectTextFormat('name\tage\nAnn\t31\nBob\t42\n')).toBe('tsv');
        expect(detectTextFormat('\tQ1\tQ2\r\nNorth\t10\t20\r\nSouth\t30\t40\r\n')).toBe('tsv');
    });

    it('takes indented lines, or rows with different numbers of tabs, as something other than TSV', () => {
        expect(detectTextFormat('\tfirst();\n\tsecond();\n')).toBe('text');
        expect(detectTextFormat('a\tb\tc\nd\te\n')).toBe('text');
    });

    it('takes rows with the same number of commas or semicolons as CSV', () => {
        expect(detectTextFormat('name,age\nAnn,31\nBob,42\n')).toBe('csv');
        expect(detectTextFormat('id;city;total\n1;Athens;"1,5"\n2;Patras;3\n')).toBe('csv');
        expect(detectTextFormat('id,note\n1,"Hello, world"\n2,"Fine, thanks"\n')).toBe('csv');
    });

    it('takes a single line, prose with commas, or uneven rows as something other than CSV', () => {
        expect(detectTextFormat('a,b,c,d')).toBe('text');
        expect(detectTextFormat('Hello, world\nHow are you, Bob\nFine, thanks\n')).toBe('text');
        expect(detectTextFormat('name,age\nAnn\n')).toBe('text');
        expect(detectTextFormat('SELECT id, name\nFROM users\n')).toBe('text');
    });

    it('takes text with Markdown structure as Markdown', () => {
        expect(detectTextFormat('# Shopping\n\n- milk\n- eggs\n')).toBe('markdown');
        expect(detectTextFormat('Read the **guide** at [the site](https://example.com).\nThanks.')).toBe('markdown');
        expect(detectTextFormat('| Name | Age |\n| --- | --- |\n| Ann | 31 |\n')).toBe('markdown');
        expect(detectTextFormat('Run this:\n\n```sh\nnpm install\n```\n')).toBe('markdown');
        expect(detectTextFormat('---\ntitle: Notes\ndate: 2026-01-01\n---\n\n# Notes\n\n- one\n- two\n')).toBe('markdown');
    });

    it('takes a lone heading, a script with comments or a numbered list as plain text', () => {
        expect(detectTextFormat('# Title')).toBe('text');
        expect(detectTextFormat('# Shopping\n\nMilk, eggs and bread.\n')).toBe('text');
        expect(detectTextFormat('# install\nnpm install\n# run\nnpm start\n')).toBe('text');
        expect(detectTextFormat('# Load the data\nimport os\n\ndef main():\n    return os.getcwd()\n')).toBe('text');
        expect(detectTextFormat('1. Call Ann\n2. Book the room\n')).toBe('text');
    });

    it('takes anything else, blank text included, as plain text', () => {
        expect(detectTextFormat('Just a note to self.\nAnd another line.')).toBe('text');
        expect(detectTextFormat('https://example.com/page?id=1')).toBe('text');
        expect(detectTextFormat('{"id":1}\n{"id":2}\n')).toBe('text');
        expect(detectTextFormat('   \n  ')).toBe('text');
        expect(detectTextFormat('')).toBe('text');
    });
});

describe('TEXT_FORMAT_EXTENSIONS', () => {
    it('gives each format the extension its files open by', () => {
        expect(TEXT_FORMAT_EXTENSIONS).toEqual({
            json: 'json',
            html: 'html',
            xml: 'xml',
            yaml: 'yaml',
            tsv: 'tsv',
            csv: 'csv',
            markdown: 'md',
            text: 'txt',
        });
    });
});
