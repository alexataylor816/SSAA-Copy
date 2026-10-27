import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface TokenPayload {
  sub: string;
  email: string;
  /** "View as" sessions only: the operator who started it (the session acts as `sub`). */
  act?: string;
  /** "View as" by a view-only operator: the session may look but not change anything. */
  ro?: boolean;
}

export function signToken(payload: TokenPayload, expiresIn: string | number = "7d"): string {
  return jwt.sign(payload, config.jwtSecretKey, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecretKey) as TokenPayload;
}
