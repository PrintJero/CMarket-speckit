import { Membership } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** The caller's ACTIVE Membership row in the community targeted by the current route. */
      membership?: Membership;
    }
  }
}

export {};
