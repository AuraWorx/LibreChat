import React, { useState } from 'react';
import { OGDialog, OGDialogContent } from '@librechat/client';
import { cn } from '~/utils';
import { useApiKeys } from '~/hooks/aura/useApiKeys';
import ApiKeysList from './ApiKeysList';
import CreateKeyForm from './CreateKeyForm';
import DeleteKeyModal from './DeleteKeyModal';
import SetupInstructions from './SetupInstructions';
import TokenRevealModal from './TokenRevealModal';
import type { ApiKey } from '~/hooks/aura/useApiKeys';

export default function ApiKeysTab() {
  const { keys, isLoading, error, createKey, deleteKey } = useApiKeys();
  const [pendingToken, setPendingToken] = useState<{ token: string; keyName: string } | null>(null);
  const [deletingKey, setDeletingKey] = useState<ApiKey | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleKeyCreated = (token: string, keyName: string) => {
    setPendingToken({ token, keyName });
  };

  const handleDeleteClick = (key: ApiKey) => {
    setDeletingKey(key);
  };

  const handleDeleteConfirm = async (id: string) => {
    setIsDeleting(true);
    try {
      await deleteKey(id);
      setDeletingKey(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-4 py-2')}>
      <div>
        <h3 className="text-base font-semibold text-text-primary">API Keys</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Generate Bedrock-backed API keys for using AWS Bedrock from external tools (Claude Code,
          Cursor, Cline, any Anthropic-SDK app).
        </p>
      </div>

      <CreateKeyForm createKey={createKey} onKeyCreated={handleKeyCreated} />

      {isLoading && <p className="text-sm text-text-secondary">Loading keys…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!isLoading && (
        <>
          <p className="text-sm font-medium text-text-primary">Your keys</p>
          <ApiKeysList keys={keys} onDeleteClick={handleDeleteClick} />
        </>
      )}

      <SetupInstructions />

      {/* Token reveal — shown once per generation */}
      {pendingToken && (
        <OGDialog open onOpenChange={() => undefined}>
          <OGDialogContent
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <TokenRevealModal
              token={pendingToken.token}
              keyName={pendingToken.keyName}
              onClose={() => setPendingToken(null)}
            />
          </OGDialogContent>
        </OGDialog>
      )}

      {/* Delete confirmation */}
      {deletingKey && (
        <OGDialog open onOpenChange={() => setDeletingKey(null)}>
          <OGDialogContent>
            <DeleteKeyModal
              keyName={deletingKey.name}
              lastFour={deletingKey.lastFour}
              keyId={deletingKey.id}
              isDeleting={isDeleting}
              onConfirm={handleDeleteConfirm}
              onCancel={() => setDeletingKey(null)}
            />
          </OGDialogContent>
        </OGDialog>
      )}
    </div>
  );
}
