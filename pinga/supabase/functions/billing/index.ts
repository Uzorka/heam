// Supabase Edge Function entry point. All logic lives in handler.js (tested in tests/unit).
import { handle } from './handler.js';

Deno.serve((req) =>
  handle(req, {
    url: Deno.env.get('SUPABASE_URL')!,
    key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY'),
    paystackKey: Deno.env.get('PAYSTACK_SECRET_KEY'),
    allowLive: Deno.env.get('ALLOW_LIVE_PAYMENTS'),
    appUrl: Deno.env.get('APP_URL'),
  })
);
