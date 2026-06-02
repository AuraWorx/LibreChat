import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ApiKeysList from './ApiKeysList';

jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick, ...props }: React.PropsWithChildren<{ onClick?: () => void; [k: string]: unknown }>) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

jest.mock('~/utils', () => ({ cn: (...args: string[]) => args.filter(Boolean).join(' ') }));

const MOCK_KEY = {
  _id: 'key1',
  name: 'claude-code-laptop',
  lastFour: 'x9zT',
  createdAt: '2026-05-28T00:00:00.000Z',
  lastUsedAt: null as string | null,
  active: true,
};

const noop = jest.fn();

describe('ApiKeysList', () => {
  it('renders the key name for each item', () => {
    render(<ApiKeysList keys={[MOCK_KEY]} onDeleteClick={noop} />);
    expect(screen.getByText('claude-code-laptop')).toBeInTheDocument();
  });

  it('renders "Ends in …XXXX" from lastFour', () => {
    render(<ApiKeysList keys={[MOCK_KEY]} onDeleteClick={noop} />);
    expect(screen.getByText(/Ends in …x9zT/)).toBeInTheDocument();
  });

  it('renders "Never used" when lastUsedAt is null', () => {
    render(<ApiKeysList keys={[MOCK_KEY]} onDeleteClick={noop} />);
    expect(screen.getByText(/Never used/)).toBeInTheDocument();
  });

  it('renders formatted date when lastUsedAt is set', () => {
    const key = { ...MOCK_KEY, lastUsedAt: '2026-05-29T12:00:00.000Z' };
    render(<ApiKeysList keys={[key]} onDeleteClick={noop} />);
    // Just check it doesn't say "Never used"
    expect(screen.queryByText(/Never used/)).not.toBeInTheDocument();
  });

  it('renders empty state when keys array is empty', () => {
    render(<ApiKeysList keys={[]} onDeleteClick={noop} />);
    expect(screen.getByText(/No API keys yet/)).toBeInTheDocument();
  });

  it('trash icon click calls onDeleteClick with the key', () => {
    const onDeleteClick = jest.fn();
    render(<ApiKeysList keys={[MOCK_KEY]} onDeleteClick={onDeleteClick} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDeleteClick).toHaveBeenCalledWith(MOCK_KEY);
  });

  it('does NOT render hash or full token in the DOM', () => {
    const key = { ...MOCK_KEY, hash: 'secret-hash', token: 'secret-token' };
    const { container } = render(<ApiKeysList keys={[key as typeof MOCK_KEY]} onDeleteClick={noop} />);
    expect(container.innerHTML).not.toContain('secret-hash');
    expect(container.innerHTML).not.toContain('secret-token');
  });
});

export {};
