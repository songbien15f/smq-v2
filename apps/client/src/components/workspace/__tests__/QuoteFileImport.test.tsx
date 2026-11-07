import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The `.sqd` import screen.
 *
 * ## What this covers that the API tests cannot
 *
 * The route is tested separately, so the risk here is the screen: a report that silently renders
 * nothing, or an "Open in the editor" button that sends a building without its customer. Both are
 * the kind of failure that leaves an operator believing an import was clean.
 *
 * ## Why the file is chosen with `fireEvent.change`
 *
 * A real file input cannot be driven from this harness, and `FileReader` works in jsdom, so the
 * component's own read path runs for real — only the browser's picker is skipped.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const api = vi.fn();
vi.mock('@/lib/sq', () => ({ api: (...args: unknown[]) => api(...args) }));

const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
const { QuoteFileImport } = await import('../QuoteFileImport');

/** A conversion report shaped exactly as the route answers one. */
const reading = {
  format: 'json',
  revisions: [
    {
      revision: 1,
      name: 'Original',
      description: '',
      quoteNumber: 'VGS-00001',
      companyName: 'Vegun Sheds',
      contractPrice: 30118.63,
      deposit: 3011.86,
      progress: 21083.04,
      balance: 6023.73,
      lastEdited: '2026-11-01T00:00:00Z',
    },
  ],
  building: {
    config: { span: 6000, length: 15000, height: 3000, bays: 4 },
    carried: ['4 bays at 3750 mm', '1 × window'],
    dropped: [
      { what: 'Skylight', detail: 'This build does not convert it.', count: 2 },
      { what: 'Wind region', detail: 'The file has no wind region.' },
    ],
    assumed: [{ what: 'Structure type', detail: 'Opened as a gable.' }],
    customer: { firstName: 'TBA', email: 'tba@example.com' },
    site: { address: '9 Site Rd' },
    claimed: { revisionName: 'Original', quoteNumber: 'VGS-00001', contractDollars: 30118.63 },
  },
};

/** Choose a file through the input, and let the component read it. */
async function choose(): Promise<void> {
  const input = screen.getByLabelText(/quote file/i) as HTMLInputElement;
  const file = new File([JSON.stringify({ SmartQuoteVersions: [] })], 'mock-test.sqd', {
    type: 'application/octet-stream',
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(api).toHaveBeenCalled());
}

beforeEach(() => {
  push.mockReset();
  api.mockReset();
});

describe('opening a legacy quote file', () => {
  it('shows what did not carry over, with the count', async () => {
    api.mockResolvedValue({ ok: true, data: reading });
    render(<QuoteFileImport />);
    await choose();

    await screen.findByText(/not carried over/i);
    expect(screen.getByText(/2 × Skylight/)).toBeInTheDocument();
    expect(screen.getByText(/Wind region/)).toBeInTheDocument();
    // The explanation is the useful half: "Skylight" alone does not tell an operator what to do.
    expect(screen.getByText(/This build does not convert it\./)).toBeInTheDocument();
  });

  it('shows what the conversion had to assume', async () => {
    api.mockResolvedValue({ ok: true, data: reading });
    render(<QuoteFileImport />);
    await choose();
    await screen.findByText(/check these before you save/i);
    expect(screen.getByText('Structure type')).toBeInTheDocument();
  });

  it('names the file’s price as the file’s, not as this build’s', async () => {
    api.mockResolvedValue({ ok: true, data: reading });
    render(<QuoteFileImport />);
    await choose();
    // The sentence, not just the number: the figure also appears in the revisions table above.
    const sentence = await screen.findByText(/Opening it re-prices the building/i);
    expect(sentence.textContent).toContain('$30118.63');
  });

  it('sends the building and the customer to the editor in the fragment', async () => {
    api.mockResolvedValue({ ok: true, data: reading });
    render(<QuoteFileImport />);
    await choose();

    fireEvent.click(await screen.findByRole('button', { name: /open in the editor/i }));

    expect(push).toHaveBeenCalledTimes(1);
    const target = String(push.mock.calls[0]?.[0]);
    expect(target.startsWith('/quotes/new#')).toBe(true);

    const hash = new URLSearchParams(target.slice(target.indexOf('#') + 1));
    // A fragment, not a query: a customer's address must not reach a server log.
    expect(target).not.toContain('?');
    expect(JSON.parse(hash.get('template') ?? '{}')).toEqual({
      span: 6000,
      length: 15000,
      height: 3000,
      bays: 4,
    });
    expect(JSON.parse(hash.get('customer') ?? '{}')).toEqual({
      customer: { firstName: 'TBA', email: 'tba@example.com' },
      site: { address: '9 Site Rd' },
    });
  });

  it('says there is no building when the revision has none', async () => {
    api.mockResolvedValue({ ok: true, data: { ...reading, building: null } });
    render(<QuoteFileImport />);
    await choose();

    await screen.findByText(/no building in this file/i);
    expect(screen.queryByRole('button', { name: /open in the editor/i })).toBeNull();
  });

  it('shows the refusal the reader gave, and offers nothing to open', async () => {
    api.mockResolvedValue({
      ok: false,
      code: 'validation_failed',
      message: 'This quote was written by the old app’s .NET BinaryFormatter path.',
    });
    render(<QuoteFileImport />);
    await choose();

    await screen.findByRole('alert');
    expect(screen.getByText(/BinaryFormatter/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open in the editor/i })).toBeNull();
  });
});
