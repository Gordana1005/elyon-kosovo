import { describe, it, expect } from 'vitest';
import { monadonSubstitute, formatMonadonProducts, formatOrderProducts } from './monadonSubstitutes';

describe('monadonSubstitute', () => {
  it('maps TESTOY (with pack/qty) to Enduro Max', () => {
    expect(monadonSubstitute('TESTOY QUATTRO X 1')?.substitute).toBe('Enduro Max');
    expect(monadonSubstitute('TESTOY QUATTRO X 1')?.display).toBe('Testoy');
    expect(monadonSubstitute('TESTOY 10 PCS X 1')?.substitute).toBe('Enduro Max');
  });

  it('prefers the more specific brand (PRO CAPS ≠ the O CAPS substring)', () => {
    expect(monadonSubstitute('PRO CAPS SINGLE X 1')?.substitute).toBe('Uro Protect');
    expect(monadonSubstitute('O CAPS 6 PCS X 1')?.substitute).toBe('Brain Active');
  });

  it('maps the operator corrections + gap fills', () => {
    expect(monadonSubstitute('PRO DROPS SINGLE X 1')?.substitute).toBe('Uro Protect'); // not Prostatol
    expect(monadonSubstitute('DIA DROPS QUATTRO X 1')?.substitute).toBe('Diabetol');   // was unmapped
    expect(monadonSubstitute('NEFRO AKTIV DUO X 1')?.substitute).toBe('Hepatol');
    expect(monadonSubstitute('GO SLIM TRIO X 1')?.substitute).toBe('Slim Complex');
    expect(monadonSubstitute('ZF IMUNO32 X 1')?.substitute).toBe('IMMUNO BOOST');
  });

  it('returns null for SPIRULINA and appliances (no substitute)', () => {
    expect(monadonSubstitute('SPIRULINA 1 PCS X 1')).toBeNull();
    expect(monadonSubstitute('GARDEN HOSE SINGLE')).toBeNull();
    expect(monadonSubstitute('TOASTER L SINGLE')).toBeNull();
  });
});

describe('formatOrderProducts', () => {
  it('shows "Brand / substitute" for a Monadon order', () => {
    expect(formatOrderProducts({ source_type: 'monadon_legacy', product_name: 'TESTOY QUATTRO X 1' }))
      .toBe('Testoy / Enduro Max');
  });

  it('leaves appliances / unmapped Monadon products as the original', () => {
    expect(formatOrderProducts({ source_type: 'monadon_legacy', product_name: 'GARDEN HOSE SINGLE' }))
      .toBe('GARDEN HOSE SINGLE');
  });

  it('maps each part of a comma-joined multi-brand Monadon cell', () => {
    expect(formatMonadonProducts('TESTOY QUATTRO X 1, BEAUTY DERM DUO X 1'))
      .toBe('Testoy / Enduro Max, Beauty Derm / ELIXY Дневен крем снаил');
  });

  it('uses the normal label for non-Monadon orders (order_items or product_name)', () => {
    expect(formatOrderProducts({ order_items: [{ product_name: 'Hepatol', quantity: 1 }] })).toBe('Hepatol');
    expect(formatOrderProducts({ source_type: null, product_name: 'Enduro Max', quantity: 2 })).toBe('Enduro Max x2');
  });

  it('supports the customer-intelligence shape (items / product_name_fallback)', () => {
    expect(formatOrderProducts({ source_type: 'monadon_legacy', product_name_fallback: 'VARCOSIN 6 PCS X 1' }))
      .toBe('Varcosin / Osteofix');
  });
});
