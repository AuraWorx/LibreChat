/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { Button } from '@librechat/client';
import { cn } from '~/utils';

interface DeleteKeyModalProps {
  keyName: string;
  lastFour: string;
  keyId: string;
  isDeleting?: boolean;
  onConfirm: (id: string) => void;
  onCancel: () => void;
}

export default function DeleteKeyModal({
  keyName,
  lastFour,
  keyId,
  isDeleting = false,
  onConfirm,
  onCancel,
}: DeleteKeyModalProps) {
  return (
    <div className={cn('flex flex-col gap-4 p-4')}>
      <h3 className="text-lg font-semibold text-text-primary">Delete API key</h3>
      <p className="text-sm text-text-secondary">
        You are about to delete key &ldquo;{keyName}&rdquo; (&hellip;{lastFour}).
      </p>
      <p className="text-sm text-text-secondary">
        Any tool currently using this token will be locked out immediately. This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          onClick={() => onConfirm(keyId)}
          disabled={isDeleting}
          aria-label={isDeleting ? 'Deleting…' : 'Delete key'}
        >
          {isDeleting ? 'Deleting…' : 'Delete key'}
        </Button>
      </div>
    </div>
  );
}
