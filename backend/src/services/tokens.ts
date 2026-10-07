import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface TokenPayload {
  sub: string;
  email: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecretKey, { expiresIn: "7d" });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecretKey) as TokenPayload;
}
