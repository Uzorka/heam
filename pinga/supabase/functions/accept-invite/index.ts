// Supabase Edge Function entry point. All logic lives in handler.js (tested in tests/unit).
import { handle } from './handler.js';

Deno.serve((req) =>
  handle(req, {
    url: Deno.env.get('SUPABASE_URL')!,
    key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  })
);
