import Database from "better-sqlite3";
import { config } from "./config.js";

export const db = new Database(config.databasePath);
