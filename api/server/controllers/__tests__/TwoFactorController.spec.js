const mockGetUserById = jest.fn();
const mockUpdateUser = jest.fn();
const mockVerifyOTPOrBackupCode = jest.fn();
const mockGenerateTOTPSecret = jest.fn();
const mockGenerateBackupCodes = jest.fn();
const mockVerifyBackupCode = jest.fn();
const mockGetTOTPSecret = jest.fn();
const mockVerifyTOTP = jest.fn();
const mockEncryptV3 = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  encryptV3: (...args) => mockEncryptV3(...args),
  logger: { error: jest.fn() },
}));

jest.mock('~/server/services/twoFactorService', () => ({
  verifyOTPOrBackupCode: (...args) => mockVerifyOTPOrBackupCode(...args),
  generateBackupCodes: (...args) => mockGenerateBackupCodes(...args),
  generateTOTPSecret: (...args) => mockGenerateTOTPSecret(...args),
  verifyBackupCode: (...args) => mockVerifyBackupCode(...args),
  getTOTPSecret: (...args) => mockGetTOTPSecret(...args),
  verifyTOTP: (...args) => mockVerifyTOTP(...args),
}));

jest.mock('~/models', () => ({
  getUserById: (...args) => mockGetUserById(...args),
  updateUser: (...args) => mockUpdateUser(...args),
}));

const {
  enable2FA,
  verify2FA,
  confirm2FA,
  disable2FA,
  regenerateBackupCodes,
} = require('~/server/controllers/TwoFactorController');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

/**
 * DocumentDB 5.0 rejects projections mixing `+select:false` overrides with bare
 * field names (AuraWorx/librechat-suite#317). Only the selector string can
 * expose this defect here, since the model layer is mocked.
 */
const PURE_OVERRIDE_SELECTOR = /^\+\w+(?: \+\w+)*$/;

function expectDocumentDbSafeSelector() {
  expect(mockGetUserById).toHaveBeenCalled();
  expect(mockGetUserById.mock.calls[0][1]).toMatch(PURE_OVERRIDE_SELECTOR);
}

const PLAIN_CODES = ['code1', 'code2', 'code3'];
const CODE_OBJECTS = [
  { codeHash: 'h1', used: false, usedAt: null },
  { codeHash: 'h2', used: false, usedAt: null },
  { codeHash: 'h3', used: false, usedAt: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateTOTPSecret.mockReturnValue('NEWSECRET');
  mockGenerateBackupCodes.mockResolvedValue({ plainCodes: PLAIN_CODES, codeObjects: CODE_OBJECTS });
  mockEncryptV3.mockReturnValue('encrypted-secret');
});

describe('enable2FA', () => {
  it('allows first-time setup without token — writes to pending fields', async () => {
    const req = { user: { id: 'user1' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue({ _id: 'user1', twoFactorEnabled: false, email: 'a@b.com' });
    mockUpdateUser.mockResolvedValue({ email: 'a@b.com' });

    await enable2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ otpauthUrl: expect.any(String), backupCodes: PLAIN_CODES }),
    );
    expect(mockVerifyOTPOrBackupCode).not.toHaveBeenCalled();
    const updateCall = mockUpdateUser.mock.calls[0][1];
    expect(updateCall).toHaveProperty('pendingTotpSecret', 'encrypted-secret');
    expect(updateCall).toHaveProperty('pendingBackupCodes', CODE_OBJECTS);
    expect(updateCall).not.toHaveProperty('twoFactorEnabled');
    expect(updateCall).not.toHaveProperty('totpSecret');
    expect(updateCall).not.toHaveProperty('backupCodes');
  });

  it('re-enrollment writes to pending fields, leaving live 2FA intact', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    const existingUser = {
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
      email: 'a@b.com',
    };
    mockGetUserById.mockResolvedValue(existingUser);
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: true });
    mockUpdateUser.mockResolvedValue({ email: 'a@b.com' });

    await enable2FA(req, res);

    expect(mockVerifyOTPOrBackupCode).toHaveBeenCalledWith({
      user: existingUser,
      token: '123456',
      backupCode: undefined,
      persistBackupUse: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    const updateCall = mockUpdateUser.mock.calls[0][1];
    expect(updateCall).toHaveProperty('pendingTotpSecret', 'encrypted-secret');
    expect(updateCall).toHaveProperty('pendingBackupCodes', CODE_OBJECTS);
    expect(updateCall).not.toHaveProperty('twoFactorEnabled');
    expect(updateCall).not.toHaveProperty('totpSecret');
  });

  it('allows re-enrollment with valid backup code (persistBackupUse: false)', async () => {
    const req = { user: { id: 'user1' }, body: { backupCode: 'backup123' } };
    const res = createRes();
    const existingUser = {
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
      email: 'a@b.com',
    };
    mockGetUserById.mockResolvedValue(existingUser);
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: true });
    mockUpdateUser.mockResolvedValue({ email: 'a@b.com' });

    await enable2FA(req, res);

    expect(mockVerifyOTPOrBackupCode).toHaveBeenCalledWith(
      expect.objectContaining({ persistBackupUse: false }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns error when no token provided and 2FA is enabled', async () => {
    const req = { user: { id: 'user1' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: false, status: 400 });

    await enable2FA(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 401 when invalid token provided and 2FA is enabled', async () => {
    const req = { user: { id: 'user1' }, body: { token: 'wrong' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({
      verified: false,
      status: 401,
      message: 'Invalid token or backup code',
    });

    await enable2FA(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token or backup code' });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe('verify2FA', () => {
  it('verifies a TOTP token against the pending secret', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({ _id: 'user1', pendingTotpSecret: 'enc-pending' });
    mockGetTOTPSecret.mockResolvedValue('SECRET');
    mockVerifyTOTP.mockResolvedValue(true);

    await verify2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(mockGetTOTPSecret).toHaveBeenCalledWith('enc-pending');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('falls back to the live secret when no pending secret exists', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({ _id: 'user1', totpSecret: 'enc-live' });
    mockGetTOTPSecret.mockResolvedValue('SECRET');
    mockVerifyTOTP.mockResolvedValue(true);

    await verify2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(mockGetTOTPSecret).toHaveBeenCalledWith('enc-live');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('verifies a backup code when no token is supplied', async () => {
    const req = { user: { id: 'user1' }, body: { backupCode: 'backup123' } };
    const res = createRes();
    const user = { _id: 'user1', pendingTotpSecret: 'enc-pending' };
    mockGetUserById.mockResolvedValue(user);
    mockGetTOTPSecret.mockResolvedValue('SECRET');
    mockVerifyBackupCode.mockResolvedValue(true);

    await verify2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(mockVerifyBackupCode).toHaveBeenCalledWith({ user, backupCode: 'backup123' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when 2FA was never initiated', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue(null);

    await verify2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: '2FA not initiated' });
  });

  it('returns 400 when the token is invalid', async () => {
    const req = { user: { id: 'user1' }, body: { token: 'wrong' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({ _id: 'user1', pendingTotpSecret: 'enc-pending' });
    mockGetTOTPSecret.mockResolvedValue('SECRET');
    mockVerifyTOTP.mockResolvedValue(false);

    await verify2FA(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token or backup code.' });
  });
});

describe('confirm2FA', () => {
  it('promotes pending secret and backup codes, enabling 2FA', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      pendingTotpSecret: 'enc-pending',
      pendingBackupCodes: CODE_OBJECTS,
    });
    mockGetTOTPSecret.mockResolvedValue('SECRET');
    mockVerifyTOTP.mockResolvedValue(true);
    mockUpdateUser.mockResolvedValue({});

    await confirm2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(mockUpdateUser).toHaveBeenCalledWith('user1', {
      totpSecret: 'enc-pending',
      twoFactorEnabled: true,
      pendingTotpSecret: null,
      pendingBackupCodes: [],
      backupCodes: CODE_OBJECTS,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('omits backupCodes from the update when no pending codes exist', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({ _id: 'user1', pendingTotpSecret: 'enc-pending' });
    mockGetTOTPSecret.mockResolvedValue('SECRET');
    mockVerifyTOTP.mockResolvedValue(true);
    mockUpdateUser.mockResolvedValue({});

    await confirm2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(mockUpdateUser.mock.calls[0][1]).not.toHaveProperty('backupCodes');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when 2FA was never initiated', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue(null);

    await confirm2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: '2FA not initiated' });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 and does not enable 2FA when the token is invalid', async () => {
    const req = { user: { id: 'user1' }, body: { token: 'wrong' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({ _id: 'user1', pendingTotpSecret: 'enc-pending' });
    mockGetTOTPSecret.mockResolvedValue('SECRET');
    mockVerifyTOTP.mockResolvedValue(false);

    await confirm2FA(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token.' });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe('disable2FA', () => {
  it('clears every 2FA field after successful verification', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: true });
    mockUpdateUser.mockResolvedValue({});

    await disable2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(mockUpdateUser).toHaveBeenCalledWith('user1', {
      totpSecret: null,
      backupCodes: [],
      twoFactorEnabled: false,
      pendingTotpSecret: null,
      pendingBackupCodes: [],
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('skips verification when 2FA is set up but not yet enabled', async () => {
    const req = { user: { id: 'user1' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: false,
      totpSecret: 'enc-secret',
    });
    mockUpdateUser.mockResolvedValue({});

    await disable2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(mockVerifyOTPOrBackupCode).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when 2FA is not set up for the user', async () => {
    const req = { user: { id: 'user1' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue({ _id: 'user1', twoFactorEnabled: false });

    await disable2FA(req, res);

    expectDocumentDbSafeSelector();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: '2FA is not setup for this user' });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 401 and preserves 2FA state when verification fails', async () => {
    const req = { user: { id: 'user1' }, body: { token: 'wrong' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({
      verified: false,
      status: 401,
      message: 'Invalid token or backup code',
    });

    await disable2FA(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token or backup code' });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe('regenerateBackupCodes', () => {
  it('returns 404 when user not found', async () => {
    const req = { user: { id: 'user1' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue(null);

    await regenerateBackupCodes(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'User not found' });
  });

  it('requires OTP when 2FA is enabled', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: true });
    mockUpdateUser.mockResolvedValue({});

    await regenerateBackupCodes(req, res);

    expectDocumentDbSafeSelector();
    expect(mockVerifyOTPOrBackupCode).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      backupCodes: PLAIN_CODES,
      backupCodesHash: CODE_OBJECTS,
    });
  });

  it('returns error when no token provided and 2FA is enabled', async () => {
    const req = { user: { id: 'user1' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: false, status: 400 });

    await regenerateBackupCodes(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 401 when invalid token provided and 2FA is enabled', async () => {
    const req = { user: { id: 'user1' }, body: { token: 'wrong' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({
      verified: false,
      status: 401,
      message: 'Invalid token or backup code',
    });

    await regenerateBackupCodes(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token or backup code' });
  });

  it('includes backupCodesHash in response', async () => {
    const req = { user: { id: 'user1' }, body: { token: '123456' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: true });
    mockUpdateUser.mockResolvedValue({});

    await regenerateBackupCodes(req, res);

    const responseBody = res.json.mock.calls[0][0];
    expect(responseBody).toHaveProperty('backupCodesHash', CODE_OBJECTS);
    expect(responseBody).toHaveProperty('backupCodes', PLAIN_CODES);
  });

  it('allows regeneration without token when 2FA is not enabled', async () => {
    const req = { user: { id: 'user1' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: false,
    });
    mockUpdateUser.mockResolvedValue({});

    await regenerateBackupCodes(req, res);

    expect(mockVerifyOTPOrBackupCode).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      backupCodes: PLAIN_CODES,
      backupCodesHash: CODE_OBJECTS,
    });
  });
});
