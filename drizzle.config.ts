// Pass the specific path to your Next.js environment file 👇
import { config } from 'dotenv';
config({ path: '.env.local' });

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './drizzle/schema.ts',
  dialect: 'postgresql',
  schemaFilter: ['public'], 
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});