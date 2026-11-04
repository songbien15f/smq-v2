import { describe, it, expect, vi, beforeEach } from 'vitest';

// Next's router has no meaning outside the app; the form calls two functions of it.
const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
const { SignInForm } = await import('../SignInForm');

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
});

describe('the sign-in form', () => {
  it('renders a company code, a username and a password, in that order', () => {
    render(<SignInForm />);

    // The order matters: it is the order a person is told to read them out, and the order the
    // server resolves them in — company first, because a username is only unique inside one.
    expect(screen.getByLabelText(/company code/i)).toHaveAttribute('id', 'companyCode');
    expect(screen.getByLabelText(/username/i)).toHaveAttribute('id', 'username');
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('id', 'password');
    expect(screen.queryByLabelText(/email/i)).toBeNull();
  });

  it('shows a typed company code in capitals', () => {
    render(<SignInForm />);
    const code = screen.getByLabelText(/company code/i) as HTMLInputElement;

    fireEvent.change(code, { target: { value: 'acme' } });

    expect(code.value).toBe('ACME');
  });

  it('posts the company code, the username and the password — never an email', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: false, code: 'unauthorized', message: 'nope' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    render(<SignInForm />);
    fireEvent.change(screen.getByLabelText(/company code/i), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'Jo' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-long-enough-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ companyCode: 'ACME', username: 'jo', password: 'a-long-enough-password' });
  });
});
