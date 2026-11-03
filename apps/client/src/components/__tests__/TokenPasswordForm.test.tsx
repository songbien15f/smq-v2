import { describe, it, expect, vi, beforeEach } from 'vitest';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
const { TokenPasswordForm } = await import('../TokenPasswordForm');

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  window.history.replaceState({}, '', '/reset#token=tok_fragment_1234567890');
});

describe('the token password form', () => {
  it('posts the token from the fragment, never from the query', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: false, code: 'validation_failed', message: 'no' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }));

    render(<TokenPasswordForm endpoint="/auth/reset/confirm" onSuccessRedirect="/quotes" />);
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'a-brand-new-password' } });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'a-brand-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ token: 'tok_fragment_1234567890' });
  });

  it('says the link is dead when there is no token at all', () => {
    window.history.replaceState({}, '', '/reset');
    render(<TokenPasswordForm endpoint="/auth/reset/confirm" onSuccessRedirect="/quotes" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer valid/i);
  });
});
