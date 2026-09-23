import type { AuthenticatedUser } from '../../modules/auth/authenticated-user';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: AuthenticatedUser;
    }
  }
}

export {};
