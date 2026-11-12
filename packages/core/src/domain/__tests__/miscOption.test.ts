import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '../defaults';
import { defaultOptionsFor, normaliseOption, resolveOptions } from '../options';
import { optionsThatNoLongerFit, refusePlacement } from '../optionRules';
import { normaliseShedConfig } from '../schema';
import { describeSelection } from '../selection';
import type { MiscOption } from '../types';

const misc = (patch: Partial<MiscOption> = {}): MiscOption => ({
  id: 'mo-1',
  kind: 'misc_option',
  name: 'Insulation',
  quantity: 1,
  unit: 'ea',
  ...patch,
});

describe('misc_option', () => {
  it('defaults to one unit with a blank name', () => {
    const [option] = defaultOptionsFor('misc_option', TEST_SHED);
    expect(option).toMatchObject({ kind: 'misc_option', name: '', quantity: 1, unit: 'ea' });
  });

  it('clamps quantity and trims the name', () => {
    const clamped = normaliseOption(misc({ name: '  Insulation  ', quantity: 0 }), TEST_SHED);
    expect(clamped).toMatchObject({ name: 'Insulation', quantity: 1 });

    const huge = normaliseOption(misc({ quantity: 5000 }), TEST_SHED);
    expect(huge.kind === 'misc_option' && huge.quantity).toBe(999);

    const blankUnit = normaliseOption(misc({ unit: '  ' }), TEST_SHED);
    expect(blankUnit.kind === 'misc_option' && blankUnit.unit).toBe('ea');
  });

  it('survives a config round-trip', () => {
    const c = normaliseShedConfig({ ...TEST_SHED, options: [misc()] });
    expect(c.options).toHaveLength(1);
    expect(c.options[0]).toMatchObject({ kind: 'misc_option', name: 'Insulation' });
  });

  it('has no plan geometry, so nothing draws and nothing reports it as unfitted', () => {
    const shed = { ...TEST_SHED, options: [misc()] };
    expect(resolveOptions(shed)).toEqual([]);
    expect(optionsThatNoLongerFit(shed)).toEqual([]);
    expect(refusePlacement('misc_option', shed)).toBeNull();
  });

  it('describes its editable quantity', () => {
    const description = describeSelection(
      { ...TEST_SHED, options: [misc()] },
      { kind: 'option', id: 'mo-1' },
    );
    expect(description.title).toBe('Miscellaneous option');
    expect(description.fields.map((field) => field.key)).toEqual(['quantity']);
  });
});
