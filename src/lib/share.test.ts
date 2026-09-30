import { describe, expect, it } from 'vitest';
import { csvCell, createCsv, emailUrl, whatsappUrl } from './share';
import { generateSummaryPdf } from './pdf';
import { EMPTY_DATA } from './defaults';

describe('portable exports', () => {
  it('neutralizes CSV formulas even when hidden after whitespace', () => {
    for (const value of ['=IMPORTXML("bad")', ' +2', '-1+2', '@SUM(A1)', '\t=2+2']) expect(csvCell(value).startsWith('"\'')).toBe(true);
    expect(csvCell('Tinto, pan')).toBe('"Tinto, pan"');
    expect(csvCell('Dijo "hola"')).toBe('"Dijo ""hola"""');
  });
  it('exports headers and a UTF-8 CSV type for an empty dataset', async () => {
    const file = createCsv(EMPTY_DATA);
    expect(file.type).toBe('text/csv;charset=utf-8');
    expect(await file.text()).toContain('"actualizado_en"');
  });
  it('encodes text-only share URLs, including financial symbols', () => {
    expect(whatsappUrl('Ahorro: $20 & más')).toBe('https://wa.me/?text=Ahorro%3A%20%2420%20%26%20m%C3%A1s');
    expect(emailUrl('a\nb')).toContain('body=a%0Ab');
  });
  it('creates a local PDF with no movements and rejects reversed ranges', async () => {
    const file = generateSummaryPdf(EMPTY_DATA, { start: '2026-09-01', end: '2026-09-30' });
    expect(file.type).toBe('application/pdf');
    expect((await file.text()).startsWith('%PDF-')).toBe(true);
    expect(file.size).toBeGreaterThan(1000);
    expect(() => generateSummaryPdf(EMPTY_DATA, { start: '2026-10-01', end: '2026-09-30' })).toThrow('rango');
  });
});
