import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DeleteKeyModal from './DeleteKeyModal';

jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick, ...props }: React.PropsWithChildren<{ onClick?: () => void; [k: string]: unknown }>) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

jest.mock('~/utils', () => ({ cn: (...args: string[]) => args.filter(Boolean).join(' ') }));

const defaultProps = {
  keyName: 'claude-code-laptop',
  lastFour: 'x9zT',
  keyId: 'key1',
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe('DeleteKeyModal', () => {
  it('renders the key name in the confirmation text', () => {
    render(<DeleteKeyModal {...defaultProps} />);
    expect(screen.getByText(/claude-code-laptop/)).toBeInTheDocument();
  });

  it('renders lastFour in the confirmation text', () => {
    render(<DeleteKeyModal {...defaultProps} />);
    expect(screen.getByText(/x9zT/)).toBeInTheDocument();
  });

  it('"Delete key" button calls onConfirm', () => {
    const onConfirm = jest.fn();
    render(<DeleteKeyModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /delete key/i }));
    expect(onConfirm).toHaveBeenCalledWith('key1');
  });

  it('"Cancel" button calls onCancel', () => {
    const onCancel = jest.fn();
    render(<DeleteKeyModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('"Cancel" does NOT call onConfirm', () => {
    const onConfirm = jest.fn();
    render(<DeleteKeyModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Delete key" shows loading state while in flight', () => {
    render(<DeleteKeyModal {...defaultProps} isDeleting />);
    const btn = screen.getByRole('button', { name: /deleting/i });
    expect(btn).toBeDisabled();
  });
});

export {};
