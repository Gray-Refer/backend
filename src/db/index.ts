import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { config } from '../config.js';

const queryClient = postgres(config.databaseUrl);

export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
