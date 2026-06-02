import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateKeyForm from './CreateKeyForm';

jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick, disabled, ...props }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean; [k: string]: unknown }>) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

jest.mock('~/utils', () => ({ cn: (...args: string[]) => args.filter(Boolean).join(' ') }));

const noop = jest.fn().mockResolvedValue({ token: 'tok', name: 'k' });
const defaultProps = { createKey: noop, onKeyCreated: jest.fn() };

describe('CreateKeyForm', () => {
  it('renders name input and "Generate Key" button', () => {
    render(<CreateKeyForm {...defaultProps} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate key/i })).toBeInTheDocument();
  });

  it('"Generate Key" is disabled when input is empty', () => {
    render(<CreateKeyForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /generate key/i })).toBeDisabled();
  });

  it('shows validation error when name exceeds 100 characters', async () => {
    render(<CreateKeyForm {...defaultProps} />);
    await userEvent.type(screen.getByRole('textbox'), 'a'.repeat(101));
    fireEvent.click(screen.getByRole('button', { name: /generate key/i }));
    await waitFor(() => expect(screen.getByText(/100 characters/i)).toBeInTheDocument());
  });

  it('calls createKey with trimmed name on valid submit', async () => {
    const createKey = jest.fn().mockResolvedValue({ token: 'tok', name: 'my-key', _id: 'k1', lastFour: 'xxxx', createdAt: '', lastUsedAt: null });
    render(<CreateKeyForm {...defaultProps} createKey={createKey} />);
    await userEvent.type(screen.getByRole('textbox'), '  my-key  ');
    fireEvent.click(screen.getByRole('button', { name: /generate key/i }));
    await waitFor(() => expect(createKey).toHaveBeenCalledWith('my-key'));
  });

  it('calls onKeyCreated with token and keyName on success', async () => {
    const createKey = jest.fn().mockResolvedValue({ token: 'the-token', name: 'my-key', _id: 'k1', lastFour: 'xxxx', createdAt: '', lastUsedAt: null });
    const onKeyCreated = jest.fn();
    render(<CreateKeyForm createKey={createKey} onKeyCreated={onKeyCreated} />);
    await userEvent.type(screen.getByRole('textbox'), 'my-key');
    fireEvent.click(screen.getByRole('button', { name: /generate key/i }));
    await waitFor(() => expect(onKeyCreated).toHaveBeenCalledWith('the-token', 'my-key'));
  });

  it('shows "name already in use" error on 409 (duplicate_name)', async () => {
    const createKey = jest.fn().mockResolvedValue({ error: 'duplicate_name' });
    render(<CreateKeyForm createKey={createKey} onKeyCreated={jest.fn()} />);
    await userEvent.type(screen.getByRole('textbox'), 'existing-key');
    fireEvent.click(screen.getByRole('button', { name: /generate key/i }));
    await waitFor(() => expect(screen.getByText(/already in use/i)).toBeInTheDocument());
  });

  it('clears the input after successful creation', async () => {
    const createKey = jest.fn().mockResolvedValue({ token: 'tok', name: 'my-key', _id: 'k1', lastFour: 'xxxx', createdAt: '', lastUsedAt: null });
    render(<CreateKeyForm createKey={createKey} onKeyCreated={jest.fn()} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'my-key');
    fireEvent.click(screen.getByRole('button', { name: /generate key/i }));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('button shows loading state while createKey is in flight', async () => {
    let resolve!: () => void;
    const createKey = jest.fn().mockReturnValue(new Promise<{ token: string; name: string }>((r) => { resolve = () => r({ token: 't', name: 'k' }); }));
    render(<CreateKeyForm createKey={createKey} onKeyCreated={jest.fn()} />);
    await userEvent.type(screen.getByRole('textbox'), 'my-key');
    fireEvent.click(screen.getByRole('button', { name: /generate key/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled());
    resolve();
  });
});

export {};
