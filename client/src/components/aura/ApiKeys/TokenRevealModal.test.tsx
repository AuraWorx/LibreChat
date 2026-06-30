import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TokenRevealModal from './TokenRevealModal';

jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: React.PropsWithChildren<{
    onClick?: () => void;
    disabled?: boolean;
    [k: string]: unknown;
  }>) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

jest.mock('~/utils', () => ({ cn: (...args: string[]) => args.filter(Boolean).join(' ') }));

const defaultProps = {
  token: 'aB3cDxK2pQ9mNvR7tZ8sLfHgYj4UwI6oVx9zT',
  keyName: 'claude-code-laptop',
  onClose: jest.fn(),
};

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
});

describe('TokenRevealModal', () => {
  it('renders the full token string', () => {
    render(<TokenRevealModal {...defaultProps} />);
    expect(screen.getByDisplayValue('aB3cDxK2pQ9mNvR7tZ8sLfHgYj4UwI6oVx9zT')).toBeInTheDocument();
  });

  it('renders the key name in the heading', () => {
    render(<TokenRevealModal {...defaultProps} />);
    expect(screen.getByText(/claude-code-laptop/)).toBeInTheDocument();
  });

  it('Copy button calls navigator.clipboard.writeText with the full token', async () => {
    render(<TokenRevealModal {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'aB3cDxK2pQ9mNvR7tZ8sLfHgYj4UwI6oVx9zT',
    );
  });

  it('Copy button text changes to "Copied!" after click', async () => {
    jest.useFakeTimers();
    render(<TokenRevealModal {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('"Close" button calls onClose', () => {
    const onClose = jest.fn();
    render(<TokenRevealModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key press does NOT call onClose', () => {
    const onClose = jest.fn();
    render(<TokenRevealModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls execCommand fallback when clipboard API rejects', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
    });
    // jsdom may not have execCommand — define it so spyOn works
    if (!document.execCommand) {
      Object.defineProperty(document, 'execCommand', {
        value: jest.fn(),
        writable: true,
        configurable: true,
      });
    }
    const execSpy = jest.spyOn(document, 'execCommand').mockReturnValue(true);
    render(<TokenRevealModal {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(execSpy).toHaveBeenCalledWith('copy');
  });
});

// eslint-disable-next-line jest/no-export
export {};
