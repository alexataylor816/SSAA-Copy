export {};

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      /** Set when an operator is viewing the app as `userId` ("view as"). */
      operatorId?: string;
    }
  }
}
