import { describe, it, expect } from 'vitest';
import {
  parseFreeStock,
  parseReservedStock,
  parseSkuBarcode,
  parseStockMatrix,
  matchRows,
  isFulfillmentPanelFile,
} from './bigarenaStock';

// Real rows copied out of "Bigarena Fulfillment - Panel (66).csv".
const HEADER = [
  'Наименование', 'Информация', 'Размери', 'Количество', 'Пресекна',
  'Роакване', 'Очакван трансфер', 'Известие за ниска наличност', 'Етикети за принтиране',
];

const row = (name: string, info: string, qty: string) =>
  [name, info, 'ДxШxВ: 0.05 x 0.05 x 0.1 м.Тегло: 0.042 кг.', qty, '0', '0', '0', '', ''];

const MATRIX = [
  HEADER,
  row('Enduro Max 30 капсули', 'SKU: NT0143Баркод: 5310416001610',
      "Резервирана наличност: 0Свободна наличност: 3310'>3310"),
  row('SAW Palmetto', 'SKU: NT0055Баркод: 5319991983748',
      "Резервирана наличност: 6Свободна наличност: 15'>21"),
  row('COLLAGEN PEPTIDES vanilla flavor 200 gr.', 'SKU: NT0108Баркод: 5310416000743',
      "Резервирана наличност: 0Свободна наличност: 1795'>1795"),
  row('Колаген Пептид со ВАНИЛА 200 гр', 'SKU: 000982Баркод: 5310416000743',
      "Резервирана наличност: 0Свободна наличност: 1084'>1084"),
  row('Диабетол Форте', 'SKU: NT0002Баркод: 5319991983298',
      "Резервирана наличност: 0Свободна наличност: 1280'>1280"),
];

describe('cell parsers', () => {
  it('reads free stock, not the trailing total', () => {
    expect(parseFreeStock("Резервирана наличност: 6Свободна наличност: 15'>21")).toBe(15);
    expect(parseFreeStock("Резервирана наличност: 0Свободна наличност: 0'>0")).toBe(0);
    expect(parseFreeStock('nonsense')).toBeNull();
  });

  it('reads reserved stock', () => {
    expect(parseReservedStock("Резервирана наличност: 6Свободна наличност: 15'>21")).toBe(6);
    expect(parseReservedStock('nonsense')).toBe(0);
  });

  it('splits SKU and barcode', () => {
    expect(parseSkuBarcode('SKU: NT0143Баркод: 5310416001610'))
      .toEqual({ sku: 'NT0143', barcode: '5310416001610' });
    // Cyrillic-МТ typo row from the real file must still parse.
    expect(parseSkuBarcode('SKU: МТ0145Баркод: 531041600184').sku).toBe('МТ0145');
  });

  it('returns a null SKU when BigArena has none (never the literal "Баркод:")', () => {
    expect(parseSkuBarcode('SKU: Баркод: 5310416001412'))
      .toEqual({ sku: null, barcode: '5310416001412' });
    expect(parseSkuBarcode('SKU: Баркод: BF-2MZJMMXBDZ').sku).toBeNull();
  });
});

describe('parseStockMatrix', () => {
  it('parses the fulfilment panel rows', () => {
    const { rows } = parseStockMatrix(MATRIX);
    const enduro = rows.find(r => r.sku === 'NT0143')!;
    expect(enduro.free).toBe(3310);
    expect(enduro.reserved).toBe(0);

    const saw = rows.find(r => r.sku === 'NT0055')!;
    expect(saw.free).toBe(15);
    expect(saw.reserved).toBe(6);
  });

  it('merges rows that share a barcode by summing free stock', () => {
    const { rows, mergedCount } = parseStockMatrix(MATRIX);
    expect(mergedCount).toBe(1);
    const collagen = rows.find(r => r.barcode === '5310416000743')!;
    expect(collagen.sku).toBe('NT0108');       // first-seen SKU wins
    expect(collagen.free).toBe(1795 + 1084);   // 2879
    expect(collagen.mergedSkus).toEqual(['000982']);
    expect(rows.filter(r => r.barcode === '5310416000743')).toHaveLength(1);
  });

  it('finds the header when a title row sits above it (xlsx export)', () => {
    const withTitle = [['Bigarena Fulfillment - Panel', '', ''], ...MATRIX];
    expect(parseStockMatrix(withTitle).rows).toHaveLength(4);
  });

  it('rejects the order-tracking export with a specific error', () => {
    const orders = [
      ['№', 'Поръчка', 'Статус'],
      ['1', 'Ref: 38016', 'Пакетирана В движение'],
    ];
    expect(parseStockMatrix(orders).error).toBe('orders_export');
  });

  it('detects the fulfilment panel header signature', () => {
    expect(isFulfillmentPanelFile(HEADER.join(' '))).toBe(true);
    expect(isFulfillmentPanelFile('№ Поръчка Статус')).toBe(false);
  });
});

describe('matchRows', () => {
  const products = [
    { id: 'a', name: 'Enduro Max 30 капсули', sku: 'NT0143', barcode: '5310416001610', stock_quantity: 2917 },
    { id: 'b', name: 'SAW Palmetto', sku: null, barcode: '5319991983748', stock_quantity: 40 },
    { id: 'c', name: 'диабетол форте', sku: null, barcode: null, stock_quantity: 1296 },
  ];

  it('matches by SKU, then barcode, then normalized name', () => {
    const { rows } = parseStockMatrix(MATRIX);
    const diffs = matchRows(rows, products);
    const byName = (n: string) => diffs.find(d => d.row.sku === n)!;

    expect(byName('NT0143').matchedBy).toBe('sku');
    expect(byName('NT0143').delta).toBe(3310 - 2917);
    expect(byName('NT0055').matchedBy).toBe('barcode');
    expect(byName('NT0055').delta).toBe(15 - 40);
    expect(byName('NT0002').matchedBy).toBe('name');
    expect(byName('NT0002').delta).toBe(1280 - 1296);
  });

  it('reports rows with no CRM product as unmatched', () => {
    const { rows } = parseStockMatrix(MATRIX);
    const unmatched = matchRows(rows, products).filter(d => !d.product);
    expect(unmatched.map(u => u.row.sku)).toEqual(['NT0108']);
  });
});
